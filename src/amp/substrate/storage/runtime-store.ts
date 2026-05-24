/**
 * Configurable SQLite runtime store with key/value and queue primitives.
 *
 * Falsifiable claim: runtime entries persist in an isolated DB path and queue
 * operations preserve FIFO order for episodic signals.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { EpisodicSignal, RuntimeQueueItem } from "./episodic-signal.js";

export const AMP_RUNTIME_PATH_ENV = "AMP_RUNTIME_PATH";

export interface RuntimeStoreOptions {
  dbPath: string;
}

export class RuntimeStore {
  private readonly db: Database.Database;

  constructor(options: RuntimeStoreOptions) {
    mkdirSync(dirname(options.dbPath), { recursive: true });
    this.db = new Database(options.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  static openFromEnv(env: NodeJS.ProcessEnv = process.env): RuntimeStore {
    return new RuntimeStore({ dbPath: resolveRuntimeDbPath(env) });
  }

  close(): void {
    this.db.close();
  }

  set(key: string, value: unknown): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO runtime_kv (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(value), now);
  }

  get<T = unknown>(key: string): T | undefined {
    const row = this.db.prepare(`SELECT value_json FROM runtime_kv WHERE key = ?`).get(key) as
      | { value_json: string }
      | undefined;
    if (!row) return undefined;
    return JSON.parse(row.value_json) as T;
  }

  delete(key: string): boolean {
    const result = this.db.prepare(`DELETE FROM runtime_kv WHERE key = ?`).run(key);
    return result.changes > 0;
  }

  queuePush(item: RuntimeQueueItem): void {
    const maxRow = this.db
      .prepare(`SELECT COALESCE(MAX(position), 0) AS max_pos FROM runtime_queue`)
      .get() as { max_pos: number };
    const position = maxRow.max_pos + 1;
    this.db
      .prepare(
        `INSERT INTO runtime_queue (id, kind, payload_json, enqueued_at, position)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(item.id, item.kind, JSON.stringify(item.payload), item.enqueued_at, position);
  }

  queuePeek(): RuntimeQueueItem | undefined {
    const row = this.db
      .prepare(
        `SELECT id, kind, payload_json, enqueued_at
         FROM runtime_queue
         ORDER BY position ASC
         LIMIT 1`
      )
      .get() as
      | { id: string; kind: string; payload_json: string; enqueued_at: string }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      kind: row.kind as RuntimeQueueItem["kind"],
      payload: JSON.parse(row.payload_json) as EpisodicSignal,
      enqueued_at: row.enqueued_at,
    };
  }

  queuePop(): RuntimeQueueItem | undefined {
    const item = this.queuePeek();
    if (!item) return undefined;
    this.db.prepare(`DELETE FROM runtime_queue WHERE id = ?`).run(item.id);
    return item;
  }

  queueList(): RuntimeQueueItem[] {
    const rows = this.db
      .prepare(
        `SELECT id, kind, payload_json, enqueued_at
         FROM runtime_queue
         ORDER BY position ASC`
      )
      .all() as Array<{ id: string; kind: string; payload_json: string; enqueued_at: string }>;

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as RuntimeQueueItem["kind"],
      payload: JSON.parse(row.payload_json) as EpisodicSignal,
      enqueued_at: row.enqueued_at,
    }));
  }

  queueRemoveIds(ids: string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(", ");
    this.db.prepare(`DELETE FROM runtime_queue WHERE id IN (${placeholders})`).run(...ids);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runtime_kv (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runtime_queue (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        enqueued_at TEXT NOT NULL,
        position INTEGER NOT NULL
      );
    `);
  }
}

/** Resolve runtime DB path from env or platform default. */
export function resolveRuntimeDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[AMP_RUNTIME_PATH_ENV]?.trim();
  if (override) return override;

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "amp", "runtime.db");
  }

  const xdgDataHome = env.XDG_DATA_HOME?.trim();
  const base = xdgDataHome && xdgDataHome.length > 0 ? xdgDataHome : join(homedir(), ".local", "share");
  return join(base, "amp", "runtime.db");
}

export function enqueueEpisodicSignal(store: RuntimeStore, signal: EpisodicSignal): void {
  store.queuePush({
    id: signal.id,
    kind: "episodic_signal",
    payload: signal,
    enqueued_at: new Date().toISOString(),
  });
}
