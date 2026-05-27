import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Frame } from "../../core/frame-schema.js";
import { createFrame } from "../../core/frame-schema.js";
import {
  DuplicateKnowledgeFrameIdError,
  LocalSqliteKnowledgeStore,
} from "./local-sqlite-knowledge-store.js";

function sampleFrame(options: {
  id: string;
  scope?: Frame["scope"];
  curationMode?: Frame["curation_mode"];
  content?: string;
}): Frame {
  return createFrame({
    id: options.id,
    kind: "semantic",
    content: options.content ?? `content for ${options.id}`,
    source: { surface: "node:test" },
    created_at: "2026-05-24T12:00:00.000Z",
    scope: options.scope ?? { kind: "project", project_ref: "ai-memory" },
    curation_mode: options.curationMode ?? "personal",
  });
}

async function withStore(
  run: (store: LocalSqliteKnowledgeStore, paths: { tempDir: string; dbPath: string }) => void
): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "amp-local-sqlite-knowledge-store-"));
  const dbPath = join(tempDir, "nested", "knowledge.db");
  const store = new LocalSqliteKnowledgeStore({ dbPath });

  try {
    run(store, { tempDir, dbPath });
  } finally {
    store.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

describe("LocalSqliteKnowledgeStore", () => {
  it("writes, reads, and lists frames in insertion order", async () => {
    await withStore((store) => {
      const first = sampleFrame({ id: "frame-001", content: "first" });
      const second = sampleFrame({ id: "frame-002", content: "second" });

      store.write([first, second]);

      assert.equal(store.read("frame-001")?.content, "first");
      assert.equal(store.read("missing"), undefined);
      assert.deepEqual(
        store.list().map((frame) => frame.id),
        ["frame-001", "frame-002"]
      );
    });
  });

  it("survives close and reopen", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-local-sqlite-knowledge-reopen-"));
    const dbPath = join(tempDir, "knowledge.db");

    try {
      const firstStore = new LocalSqliteKnowledgeStore({ dbPath });
      firstStore.write([sampleFrame({ id: "frame-persisted", content: "persisted" })]);
      firstStore.close();

      const secondStore = new LocalSqliteKnowledgeStore({ dbPath });
      try {
        assert.equal(secondStore.read("frame-persisted")?.content, "persisted");
      } finally {
        secondStore.close();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("filters by scope, project, and curation mode", async () => {
    await withStore((store) => {
      store.write([
        sampleFrame({ id: "project-ai", scope: { kind: "project", project_ref: "ai-memory" } }),
        sampleFrame({
          id: "project-other",
          scope: { kind: "project", project_ref: "other" },
          curationMode: "shared",
        }),
        sampleFrame({
          id: "user-frame",
          scope: { kind: "user" },
          curationMode: "llm_curated",
        }),
      ]);

      assert.deepEqual(
        store.list({ scopeKind: "project" }).map((frame) => frame.id),
        ["project-ai", "project-other"]
      );
      assert.deepEqual(
        store.list({ projectRef: "ai-memory" }).map((frame) => frame.id),
        ["project-ai"]
      );
      assert.deepEqual(
        store.list({ curationMode: "llm_curated" }).map((frame) => frame.id),
        ["user-frame"]
      );
    });
  });

  it("fails closed on duplicate frame ids", async () => {
    await withStore((store) => {
      store.write([sampleFrame({ id: "duplicate", content: "original" })]);

      assert.throws(
        () => store.write([sampleFrame({ id: "duplicate", content: "replacement" })]),
        DuplicateKnowledgeFrameIdError
      );
      assert.throws(
        () =>
          store.write([
            sampleFrame({ id: "same-batch", content: "first" }),
            sampleFrame({ id: "same-batch", content: "second" }),
          ]),
        DuplicateKnowledgeFrameIdError
      );
      assert.equal(store.read("duplicate")?.content, "original");
      assert.equal(store.read("same-batch"), undefined);
    });
  });

  it("rejects invalid frames before storage", async () => {
    await withStore((store) => {
      const invalidFrame: unknown = {
        ...sampleFrame({ id: "invalid-frame" }),
        kind: "invalid",
      };

      assert.throws(
        () => store.write([invalidFrame as Frame]),
        /Frame failed schema validation/
      );
      assert.equal(store.read("invalid-frame"), undefined);
    });
  });

  it("creates parent directories for the database path", async () => {
    await withStore((_store, paths) => {
      assert.equal(existsSync(dirname(paths.dbPath)), true);
    });
  });

  it("keeps batch writes all-or-nothing for invalid and duplicate frames", async () => {
    await withStore((store) => {
      const invalidFrame: unknown = {
        ...sampleFrame({ id: "invalid-in-batch" }),
        scope: { kind: "project" },
      };

      assert.throws(
        () =>
          store.write([
            sampleFrame({ id: "valid-before-invalid" }),
            invalidFrame as Frame,
          ]),
        /Frame failed schema validation/
      );
      assert.equal(store.list().length, 0);

      store.write([sampleFrame({ id: "existing" })]);
      assert.throws(
        () =>
          store.write([
            sampleFrame({ id: "valid-before-duplicate" }),
            sampleFrame({ id: "existing" }),
          ]),
        DuplicateKnowledgeFrameIdError
      );

      assert.deepEqual(
        store.list().map((frame) => frame.id),
        ["existing"]
      );
    });
  });

  it("mirrors in-memory conservative capabilities", async () => {
    await withStore((store) => {
      assert.equal(store.capabilities().vector_search, "unsupported");
      assert.equal(store.capabilities().transactions, "wrapped");
    });
  });

  it("creates planned list and filter indexes on migration", async () => {
    await withStore((_store, paths) => {
      const db = new Database(paths.dbPath, { readonly: true });
      try {
        const indexes = db
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'index'
               AND tbl_name = 'knowledge_frame'
               AND name NOT LIKE 'sqlite_%'`
          )
          .all() as Array<{ name: string }>;
        assert.deepEqual(
          indexes.map((row) => row.name).sort(),
          [
            "knowledge_frame_curation_idx",
            "knowledge_frame_position_idx",
            "knowledge_frame_scope_idx",
          ]
        );
      } finally {
        db.close();
      }
    });
  });
});
