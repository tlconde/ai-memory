import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
});
