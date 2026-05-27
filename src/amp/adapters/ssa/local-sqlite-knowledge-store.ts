/**
 * Local SQLite knowledge store adapter for AMP frames.
 *
 * Falsifiable claim: validated frames persist in insertion order and duplicate
 * ids fail without overwriting existing knowledge.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import {
  createSliceCapabilityCoverage,
  type CapabilityCoverage,
} from "../../adapter-contract/capability-coverage.js";
import { frameSchemaMismatch } from "../../core/errors.js";
import type { Frame } from "../../core/frame-schema.js";
import { parseFrame, serializeFrame } from "../../core/frame-schema.js";
import {
  type KnowledgeListFilter,
  type KnowledgeStore,
} from "../../substrate/storage/knowledge-store.js";

export interface LocalSqliteKnowledgeStoreOptions {
  dbPath: string;
}

interface KnowledgeFrameRow {
  frame_json: string;
}

export class DuplicateKnowledgeFrameIdError extends Error {
  constructor(id: string) {
    super(`Duplicate knowledge frame id: ${id}`);
    this.name = "DuplicateKnowledgeFrameIdError";
  }
}

export class LocalSqliteKnowledgeStore implements KnowledgeStore {
  private readonly db: Database.Database;
  private readonly coverage: CapabilityCoverage;
  private readonly insertFrames: (frames: Frame[]) => void;

  constructor(options: LocalSqliteKnowledgeStoreOptions) {
    mkdirSync(dirname(options.dbPath), { recursive: true });
    this.db = new Database(options.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.coverage = createSliceCapabilityCoverage();
    this.migrate();
    const insertFramesTransaction = this.db.transaction((frames: Frame[]) => {
      this.assertNoExistingIds(frames.map((frame) => frame.id));
      const maxPosition = this.nextPositionBase();
      const updatedAt = new Date().toISOString();
      const insert = this.db.prepare(`
        INSERT INTO knowledge_frame (
          id, kind, scope_kind, project_ref, curation_mode,
          frame_json, created_at, updated_at, position
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      frames.forEach((frame, index) => {
        insert.run(
          frame.id,
          frame.kind,
          frame.scope.kind,
          frame.scope.project_ref ?? null,
          frame.curation_mode,
          JSON.stringify(serializeFrame(frame)),
          frame.created_at,
          updatedAt,
          maxPosition + index
        );
      });
    });
    this.insertFrames = (frames: Frame[]) => {
      insertFramesTransaction.immediate(frames);
    };
  }

  close(): void {
    this.db.close();
  }

  write(frames: Frame[]): void {
    const parsedFrames = frames.map((candidate) => {
      const parsed = parseFrame(candidate);
      if (!parsed.success) {
        throw frameSchemaMismatch(parsed.error);
      }
      return parsed.frame;
    });

    this.assertNoDuplicateBatchIds(parsedFrames);
    this.insertFrames(parsedFrames);
  }

  read(id: string): Frame | undefined {
    const row = this.db
      .prepare(`SELECT frame_json FROM knowledge_frame WHERE id = ?`)
      .get(id) as KnowledgeFrameRow | undefined;

    if (!row) return undefined;
    return this.parseStoredFrame(row.frame_json);
  }

  list(filter: KnowledgeListFilter = {}): Frame[] {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.scopeKind) {
      where.push("scope_kind = ?");
      params.push(filter.scopeKind);
    }
    if (filter.projectRef) {
      where.push("project_ref = ?");
      params.push(filter.projectRef);
    }
    if (filter.curationMode) {
      where.push("curation_mode = ?");
      params.push(filter.curationMode);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT frame_json
         FROM knowledge_frame
         ${whereClause}
         ORDER BY position ASC`
      )
      .all(...params) as KnowledgeFrameRow[];

    return rows.map((row) => this.parseStoredFrame(row.frame_json));
  }

  capabilities(): CapabilityCoverage {
    return structuredClone(this.coverage);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_frame (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        scope_kind TEXT NOT NULL,
        project_ref TEXT,
        curation_mode TEXT NOT NULL,
        frame_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        position INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS knowledge_frame_scope_idx
        ON knowledge_frame(scope_kind, project_ref);
      CREATE INDEX IF NOT EXISTS knowledge_frame_curation_idx
        ON knowledge_frame(curation_mode);
      CREATE INDEX IF NOT EXISTS knowledge_frame_position_idx
        ON knowledge_frame(position);
    `);
  }

  private nextPositionBase(): number {
    const row = this.db
      .prepare(`SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM knowledge_frame`)
      .get() as { next_position: number };
    return row.next_position;
  }

  private assertNoDuplicateBatchIds(frames: Frame[]): void {
    const seen = new Set<string>();
    for (const frame of frames) {
      if (seen.has(frame.id)) {
        throw new DuplicateKnowledgeFrameIdError(frame.id);
      }
      seen.add(frame.id);
    }
  }

  private assertNoExistingIds(ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(", ");
    const row = this.db
      .prepare(`SELECT id FROM knowledge_frame WHERE id IN (${placeholders}) LIMIT 1`)
      .get(...ids) as { id: string } | undefined;

    if (row) {
      throw new DuplicateKnowledgeFrameIdError(row.id);
    }
  }

  private parseStoredFrame(frameJson: string): Frame {
    const parsedJson = JSON.parse(frameJson) as unknown;
    const parsedFrame = parseFrame(parsedJson);
    if (!parsedFrame.success) {
      throw frameSchemaMismatch(parsedFrame.error);
    }
    return parsedFrame.frame;
  }
}
