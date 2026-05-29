import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import {
  RuntimeStore,
  enqueueEpisodicSignal,
  resolveRuntimeDbPath,
} from "./runtime-store.js";

describe("resolveRuntimeDbPath", () => {
  it("uses AMP_RUNTIME_PATH when set", () => {
    const path = resolveRuntimeDbPath({ AMP_RUNTIME_PATH: "/tmp/custom/runtime.db" });
    assert.equal(path, "/tmp/custom/runtime.db");
  });
});

describe("RuntimeStore", () => {
  let tempDir = "";
  let store: RuntimeStore;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-test-"));
    store = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
  });

  after(async () => {
    store.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("set/get/delete round-trip", () => {
    store.set("active_intent", { description: "ship amp slice" });
    assert.deepEqual(store.get("active_intent"), { description: "ship amp slice" });
    assert.equal(store.delete("active_intent"), true);
    assert.equal(store.get("active_intent"), undefined);
  });

  it("creates parent directories for nested dbPath", async () => {
    const nestedDir = join(tempDir, "nested", "amp");
    const nestedStore = new RuntimeStore({ dbPath: join(nestedDir, "runtime.db") });
    nestedStore.set("probe", true);
    assert.equal(nestedStore.get("probe"), true);
    nestedStore.close();
  });

  it("queue preserves FIFO order", () => {
    enqueueEpisodicSignal(store, {
      id: "sig-1",
      content: "first",
      scope: "project",
      projectRef: "ai-memory",
      source: { surface: "cursor", captured_at: "2026-05-24T12:00:00.000Z" },
    });
    enqueueEpisodicSignal(store, {
      id: "sig-2",
      content: "second",
      scope: "project",
      projectRef: "ai-memory",
      source: { surface: "cursor", captured_at: "2026-05-24T12:01:00.000Z" },
    });

    const first = store.queuePop();
    assert.equal(first?.payload.content, "first");
    const second = store.queuePop();
    assert.equal(second?.payload.content, "second");
    assert.equal(store.queuePeek(), undefined);
  });

  it("semanticEntityList returns empty array when no typed rows exist", () => {
    assert.deepEqual(store.semanticEntityList(), []);
  });

  it("semanticEntityInsert preserves insertion order", () => {
    store.semanticEntityInsert({
      id: "pref-a",
      kind: "runtime-preference-candidate",
      scope: "user",
      payload: { id: "pref-a", statement: "first" },
    });
    store.semanticEntityInsert({
      id: "pref-b",
      kind: "runtime-preference-candidate",
      scope: "user",
      payload: { id: "pref-b", statement: "second" },
    });

    const listed = store.semanticEntityList();
    assert.deepEqual(
      listed.map((row) => row.id),
      ["pref-a", "pref-b"]
    );
  });

  it("marks semantic entity rows as graduated without changing payload", () => {
    store.semanticEntityInsert({
      id: "pref-graduate",
      kind: "runtime-preference-candidate",
      scope: "user",
      payload: { id: "pref-graduate", statement: "graduate me" },
    });

    const marked = store.semanticEntityMarkGraduated("pref-graduate", "2026-05-29T12:00:00.000Z");
    assert.equal(marked, true);

    const row = store.semanticEntityList().find((entry) => entry.id === "pref-graduate");
    assert.equal(row?.graduation_status, "graduated");
    assert.equal(row?.graduated_at, "2026-05-29T12:00:00.000Z");
    assert.deepEqual(row?.payload, { id: "pref-graduate", statement: "graduate me" });
  });

  it("returns false when marking an unknown semantic entity id", () => {
    assert.equal(
      store.semanticEntityMarkGraduated("missing-id", "2026-05-29T12:00:00.000Z"),
      false,
    );
  });
});

describe("RuntimeStore semanticEntityHas", () => {
  it("reports presence after low-level insert", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-has-test-"));
    const isolated = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    try {
      assert.equal(isolated.semanticEntityHas("pref-probe"), false);
      isolated.semanticEntityInsert({
        id: "pref-probe",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: { id: "pref-probe" },
      });
      assert.equal(isolated.semanticEntityHas("pref-probe"), true);
    } finally {
      isolated.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("RuntimeStore semantic entity graduation migration", () => {
  it("adds graduation columns without changing existing rows", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-graduation-migrate-"));
    const dbPath = join(tempDir, "runtime.db");

    const legacy = new Database(dbPath);
    try {
      legacy.exec(`
        CREATE TABLE runtime_semantic_entity (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          scope TEXT NOT NULL,
          project_ref TEXT,
          payload_json TEXT NOT NULL,
          observed_at TEXT,
          position INTEGER NOT NULL
        );
      `);
      legacy
        .prepare(
          `INSERT INTO runtime_semantic_entity (
             id, kind, scope, project_ref, payload_json, observed_at, position
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "pref-legacy",
          "runtime-preference-candidate",
          "user",
          null,
          JSON.stringify({ id: "pref-legacy", statement: "legacy row" }),
          null,
          1,
        );
    } finally {
      legacy.close();
    }

    const reopened = new RuntimeStore({ dbPath });
    try {
      const row = reopened.semanticEntityList()[0];
      assert.equal(row?.id, "pref-legacy");
      assert.equal(row?.graduation_status, undefined);
      assert.equal(row?.graduated_at, undefined);

      assert.equal(
        reopened.semanticEntityMarkGraduated("pref-legacy", "2026-05-29T12:00:00.000Z"),
        true,
      );
      const promoted = reopened.semanticEntityList()[0];
      assert.equal(promoted?.graduation_status, "graduated");
      assert.equal(promoted?.graduated_at, "2026-05-29T12:00:00.000Z");
      assert.deepEqual(promoted?.payload, { id: "pref-legacy", statement: "legacy row" });
    } finally {
      reopened.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
