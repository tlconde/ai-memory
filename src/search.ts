// SQLite FTS5 search over every layer. See SPEC.md 3.3.

import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inside, isSafeId, listNotes, listSessions, memoryRoot, readLogSince, readNote } from './store.js';
import { BUDGETS, LAYOUT, type Layer, type SearchHit } from './types.js';

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

/**
 * `weighted` (default) scales bm25 by layer, so relevance can beat layer. `tiers` is the strict alternative
 * the eval compares against: verified notes, then wiki, unverified notes, log, past, ties by bm25.
 */
export type Ranking = 'weighted' | 'tiers';
export const RANKINGS: readonly Ranking[] = ['weighted', 'tiers'];

export interface SearchOptions {
  limit?: number;
  layers?: readonly Layer[];
  root?: string;
  ranking?: Ranking;
}

/** Queries the index as it stands; call `reindex` first for fresh results. */
export function search(query: string, opts: SearchOptions = {}): SearchHit[] {
  const root = opts.root ?? memoryRoot();
  const limit = opts.limit ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('limit must be an integer from 1 to 1000');
  const layers = opts.layers ?? LAYERS;
  for (const l of layers) if (!LAYERS.includes(l)) throw new Error(`unknown layer "${l}"`);
  const ranking = opts.ranking ?? 'weighted';
  if (!RANKINGS.includes(ranking)) throw new Error(`unknown ranking "${String(ranking)}"`);
  // Both orderings are built from constants, never from input.
  const score =
    ranking === 'tiers'
      ? 'bm25(docs)'
      : `bm25(docs) * CASE
                  WHEN layer = 'notes' AND verified = 1 THEN ${WEIGHT.verifiedNote}
                  WHEN layer = 'notes' THEN ${WEIGHT.note}
                  WHEN layer = 'wiki' THEN ${WEIGHT.wiki}
                  WHEN layer = 'past' THEN ${WEIGHT.past}
                  ELSE ${WEIGHT.log}
                END`;
  const order =
    ranking === 'tiers'
      ? `CASE WHEN layer = 'notes' AND verified = 1 THEN 0 WHEN layer = 'wiki' THEN 1 WHEN layer = 'notes' THEN 2 WHEN layer = 'log' THEN 3 ELSE 4 END, score`
      : 'score';
  const match = toMatch(query);
  if (match === undefined || layers.length === 0 || !existsSync(root)) return [];

  const db = open(root);
  try {
    const rows = db
      .prepare(
        `SELECT layer, source, verified,
                snippet(docs, 4, '**', '**', '…', 16) AS snippet,
                ${score} AS score
         FROM docs
         WHERE docs MATCH ? AND layer IN (${layers.map(() => '?').join(', ')})
         ORDER BY ${order}
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

// ---------------------------------------------------------------- eval (SPEC.md 4)

/** One retrieval case: `expect` lists sources (`<session>:<line>`, note id, wiki page); any one in the top k is a hit. */
export interface EvalQuery {
  q: string;
  expect: string[];
  k: number;
}

/** A fact survives when every term appears, case-insensitively, in at least one note or wiki page. */
export interface EvalFact {
  fact: string;
  terms: string[];
}

export interface EvalCases {
  queries: EvalQuery[];
  facts: EvalFact[];
}

export interface EvalReport {
  ranking: Ranking;
  sessions: number;
  retrieval: { queries: number; hits: number; hitRate: number | null; mrr: number | null };
  index: { tokens: number; estimate: 'ceil(chars/4)'; budget: number };
  facts: { total: number; survived: number; rate: number | null };
  misses: { q: string; expect: string[]; got: string[] }[];
}

const CASES_FILE = 'cases.json';
const DEFAULT_K = 5;

function nonEmptyStrings(x: unknown): x is string[] {
  return Array.isArray(x) && x.length > 0 && x.every((s) => typeof s === 'string' && s.trim() !== '');
}

/** Validates an untrusted `cases.json` value; throws with the first problem found. */
export function parseCases(x: unknown): EvalCases {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) throw new Error('cases must be a JSON object');
  const { queries, facts = [] } = x as Record<string, unknown>;
  if (!Array.isArray(queries)) throw new Error('cases.queries must be an array');
  if (!Array.isArray(facts)) throw new Error('cases.facts must be an array');
  return {
    queries: queries.map((c: unknown, i): EvalQuery => {
      const { q, expect, k = DEFAULT_K } = (typeof c === 'object' && c !== null ? c : {}) as Record<string, unknown>;
      if (typeof q !== 'string' || q.trim() === '') throw new Error(`queries[${i}].q must be a non-empty string`);
      if (!nonEmptyStrings(expect)) throw new Error(`queries[${i}].expect must be a non-empty array of sources`);
      if (typeof k !== 'number' || !Number.isInteger(k) || k < 1 || k > 1000) throw new Error(`queries[${i}].k must be an integer from 1 to 1000`);
      return { q, expect, k };
    }),
    facts: facts.map((f: unknown, i): EvalFact => {
      const { fact, terms } = (typeof f === 'object' && f !== null ? f : {}) as Record<string, unknown>;
      if (typeof fact !== 'string' || fact.trim() === '') throw new Error(`facts[${i}].fact must be a non-empty string`);
      if (!nonEmptyStrings(terms)) throw new Error(`facts[${i}].terms must be a non-empty array of strings`);
      return { fact, terms };
    }),
  };
}

/** Token estimate used for the index budget: ceil(chars / 4). Not a tokenizer count. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const ratio = (n: number, d: number): number | null => (d === 0 ? null : n / d);

/**
 * Replays a suite: copies it to a temp memory root (the suite itself is never written), reindexes, runs
 * every query at its k, and measures INDEX.md and fact survival. The temp root is removed afterwards.
 */
export function runEval(suite: string, opts: { ranking?: Ranking } = {}): EvalReport {
  const ranking = opts.ranking ?? 'weighted';
  const casesPath = join(suite, CASES_FILE);
  if (!existsSync(casesPath)) throw new Error(`no ${CASES_FILE} in suite ${suite}`);
  const cases = parseCases(JSON.parse(readFileSync(casesPath, 'utf8')));
  const tmp = mkdtempSync(join(tmpdir(), 'mem-eval-'));
  try {
    const root = join(tmp, '.memory');
    // A stale search index (and its -wal/-shm files) in the suite would hide changes to the fixtures.
    cpSync(suite, root, { recursive: true, filter: (src) => src !== casesPath && !basename(src).startsWith(INDEX_FILE) });
    reindex(root);

    let hits = 0;
    let rr = 0;
    const misses: EvalReport['misses'] = [];
    for (const c of cases.queries) {
      const got = search(c.q, { root, limit: c.k, ranking }).map((h) => h.source);
      const rank = got.findIndex((s) => c.expect.includes(s));
      if (rank >= 0) {
        hits += 1;
        rr += 1 / (rank + 1);
      } else {
        misses.push({ q: c.q, expect: c.expect, got });
      }
    }

    const indexFile = join(root, LAYOUT.index);
    const tokens = existsSync(indexFile) ? estimateTokens(readFileSync(indexFile, 'utf8')) : 0;

    const docs = [
      ...listNotes('notes', root).map((n) => `${n.about}\n${n.body}`),
      ...markdownFiles(root, 'wiki').map((p) => readFileSync(inside(root, p), 'utf8')),
    ].map((d) => d.toLowerCase());
    const survived = cases.facts.filter((f) => docs.some((d) => f.terms.every((t) => d.includes(t.toLowerCase())))).length;

    const n = cases.queries.length;
    return {
      ranking,
      sessions: listSessions(root).length,
      retrieval: { queries: n, hits, hitRate: ratio(hits, n), mrr: ratio(rr, n) },
      index: { tokens, estimate: 'ceil(chars/4)', budget: BUDGETS.indexTokens },
      facts: { total: cases.facts.length, survived, rate: ratio(survived, cases.facts.length) },
      misses,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
