// SQLite FTS5 search over every layer. See SPEC.md 3.3.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { inside, isSafeId, listSessions, memoryRoot, readLogSince, readNote } from './store.js';
import { LAYOUT, type Layer, type SearchHit } from './types.js';

const INDEX_FILE = '.search.sqlite';
// Bump when the schema or the indexed text changes; a mismatch drops and rebuilds the index.
const SCHEMA_VERSION = 1;

// bm25() is negative and lower is better, so a weight above 1 lifts a layer and below 1 sinks it. A verified
// note needs only half the term-match strength of a log line to outrank it; a past finding needs twice. Wiki
// pages are dream-confirmed facts, so they sit above unconfirmed notes but below verified ones. Weights scale
// relevance rather than imposing strict tiers, so a strong log match still beats a weak note match.
const WEIGHT = { verifiedNote: 2.0, wiki: 1.5, note: 1.2, log: 1.0, past: 0.5 } as const;

const LAYERS: readonly Layer[] = ['log', 'notes', 'wiki', 'past'];

function open(root: string): DatabaseSync {
  const db = new DatabaseSync(inside(root, INDEX_FILE));
  db.exec('PRAGMA busy_timeout = 5000');
  const row = db.prepare('PRAGMA user_version').get();
  if (row?.user_version !== SCHEMA_VERSION) {
    db.exec(`
      DROP TABLE IF EXISTS docs;
      DROP TABLE IF EXISTS files;
      CREATE VIRTUAL TABLE docs USING fts5(layer UNINDEXED, source UNINDEXED, file UNINDEXED, verified UNINDEXED, body, tokenize = 'porter unicode61');
      CREATE TABLE files (path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime REAL NOT NULL, offset INTEGER NOT NULL, line INTEGER NOT NULL);
      PRAGMA user_version = ${SCHEMA_VERSION};
    `);
  }
  return db;
}

interface FileState {
  size: number;
  mtime: number;
  offset: number;
  line: number;
}

function markdownFiles(root: string, layer: 'notes' | 'wiki' | 'past'): string[] {
  const dir = inside(root, LAYOUT[layer]);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => `${LAYOUT[layer]}/${f}`);
}

/**
 * Brings the index up to date. Incremental per file: log files are append-only, so only bytes after the
 * last indexed line are read (a file that shrank is re-read from the start); a markdown file whose size or
 * mtime changed is re-indexed whole; rows for deleted files are dropped. Runs in one IMMEDIATE transaction
 * so concurrent callers serialize instead of indexing the same lines twice.
 */
export function reindex(root: string = memoryRoot()): void {
  if (!existsSync(root)) return;
  const db = open(root);
  let inTransaction = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    inTransaction = true;
    const known = new Map<string, FileState>();
    for (const r of db.prepare('SELECT path, size, mtime, offset, line FROM files').all()) {
      known.set(String(r.path), { size: Number(r.size), mtime: Number(r.mtime), offset: Number(r.offset), line: Number(r.line) });
    }
    const insert = db.prepare('INSERT INTO docs (layer, source, file, verified, body) VALUES (?, ?, ?, ?, ?)');
    const dropDocs = db.prepare('DELETE FROM docs WHERE file = ?');
    const save = db.prepare('INSERT OR REPLACE INTO files (path, size, mtime, offset, line) VALUES (?, ?, ?, ?, ?)');
    const seen = new Set<string>();

    for (const session of listSessions(root)) {
      const path = `${LAYOUT.log}/${session}.jsonl`;
      seen.add(path);
      const { size, mtimeMs } = statSync(inside(root, path));
      let state = known.get(path) ?? { size: 0, mtime: 0, offset: 0, line: 0 };
      if (state.size === size && state.mtime === mtimeMs) continue;
      if (size < state.offset) {
        dropDocs.run(path);
        state = { size: 0, mtime: 0, offset: 0, line: 0 };
      }
      const { entries, cursor } = readLogSince(session, state, root);
      for (const { line, event } of entries) {
        const body = [event.tool, event.text, ...(event.refs ?? [])].filter(Boolean).join('\n');
        insert.run('log', `${session}:${line}`, path, null, body);
      }
      save.run(path, size, mtimeMs, cursor.offset, cursor.line);
    }

    for (const layer of ['notes', 'wiki', 'past'] as const) {
      for (const path of markdownFiles(root, layer)) {
        const name = path.slice(LAYOUT[layer].length + 1, -'.md'.length);
        if (layer !== 'wiki' && !isSafeId(name)) continue;
        seen.add(path);
        const { size, mtimeMs } = statSync(inside(root, path));
        const state = known.get(path);
        if (state?.size === size && state.mtime === mtimeMs) continue;
        dropDocs.run(path);
        if (layer === 'wiki') {
          insert.run('wiki', name, path, null, readFileSync(inside(root, path), 'utf8'));
        } else {
          const note = readNote(name, layer, root);
          if (note) insert.run(layer, note.id, path, note.verified ? 1 : 0, `${note.about}\n${note.body}`);
        }
        save.run(path, size, mtimeMs, 0, 0);
      }
    }

    const dropFile = db.prepare('DELETE FROM files WHERE path = ?');
    for (const path of known.keys()) {
      if (seen.has(path)) continue;
      dropDocs.run(path);
      dropFile.run(path);
    }
    db.exec('COMMIT');
    inTransaction = false;
  } catch (err) {
    if (inTransaction) db.exec('ROLLBACK');
    throw err;
  } finally {
    db.close();
  }
}

/**
 * Turns free text into an FTS5 expression that cannot be a syntax error: each whitespace-separated chunk
 * becomes a quoted phrase (embedded quotes doubled), chunks without a letter or digit are dropped, and
 * phrases are OR-ed so bm25 rewards documents matching more of them instead of requiring all.
 */
export function toMatch(query: string): string | undefined {
  const phrases = query
    .split(/\s+/)
    .filter((chunk) => /[\p{L}\p{N}]/u.test(chunk))
    .map((chunk) => `"${chunk.replaceAll('"', '""')}"`);
  return phrases.length > 0 ? phrases.join(' OR ') : undefined;
}

export interface SearchOptions {
  limit?: number;
  layers?: readonly Layer[];
  root?: string;
}

/** Queries the index as it stands; call `reindex` first for fresh results. */
export function search(query: string, opts: SearchOptions = {}): SearchHit[] {
  const root = opts.root ?? memoryRoot();
  const limit = opts.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('limit must be an integer from 1 to 1000');
  const layers = opts.layers ?? LAYERS;
  for (const l of layers) if (!LAYERS.includes(l)) throw new Error(`unknown layer "${l}"`);
  const match = toMatch(query);
  if (match === undefined || layers.length === 0 || !existsSync(root)) return [];

  const db = open(root);
  try {
    const rows = db
      .prepare(
        `SELECT layer, source, verified,
                snippet(docs, 4, '**', '**', '…', 16) AS snippet,
                bm25(docs) * CASE
                  WHEN layer = 'notes' AND verified = 1 THEN ${WEIGHT.verifiedNote}
                  WHEN layer = 'notes' THEN ${WEIGHT.note}
                  WHEN layer = 'wiki' THEN ${WEIGHT.wiki}
                  WHEN layer = 'past' THEN ${WEIGHT.past}
                  ELSE ${WEIGHT.log}
                END AS score
         FROM docs
         WHERE docs MATCH ? AND layer IN (${layers.map(() => '?').join(', ')})
         ORDER BY score
         LIMIT ?`,
      )
      .all(match, ...layers, limit);
    return rows.map((r): SearchHit => {
      const layer = LAYERS.find((l) => l === r.layer);
      if (layer === undefined) throw new Error(`index holds unknown layer ${String(r.layer)}`);
      return {
        layer,
        source: String(r.source),
        snippet: String(r.snippet).replace(/\s+/g, ' ').trim(),
        score: Number(r.score),
        ...(layer === 'notes' || layer === 'past' ? { verified: r.verified === 1 } : {}),
      };
    });
  } finally {
    db.close();
  }
}
