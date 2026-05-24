import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryKnowledgeStore } from "../../adapters/ssa/in-memory-knowledge-store.js";
import { AmpError } from "../../core/errors.js";
import { consolidateNow } from "./consolidation-minimal.js";
import type { KnowledgeStore } from "./knowledge-store.js";
import { enqueueEpisodicSignal, RuntimeStore } from "./runtime-store.js";

describe("consolidateNow", () => {
  let tempDir = "";
  let runtime: RuntimeStore;
  let knowledge: InMemoryKnowledgeStore;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "amp-consolidation-test-"));
    runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    knowledge = new InMemoryKnowledgeStore();
  });

  after(async () => {
    runtime.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("drains queue into knowledge store and clears runtime queue", () => {
    enqueueEpisodicSignal(runtime, {
      id: "sig-pref-1",
      content: "Always run typecheck before commit.",
      scope: "project",
      projectRef: "ai-memory",
      source: { surface: "cursor", harness: "cursor", captured_at: "2026-05-24T12:00:00.000Z" },
    });

    const result = consolidateNow(runtime, knowledge);
    assert.equal(result.processed, 1);
    assert.equal(runtime.queuePeek(), undefined);

    const frame = knowledge.read("frame-sig-pref-1");
    assert.equal(frame?.content, "Always run typecheck before commit.");
    assert.equal(frame?.scope.kind, "project");
    assert.equal(frame?.curation_mode, "personal");
  });

  it("retains queued signals when knowledge write fails", () => {
    class FailingKnowledgeStore implements KnowledgeStore {
      write(): void {
        throw new Error("knowledge write failed");
      }
      read() {
        return undefined;
      }
      list() {
        return [];
      }
      capabilities() {
        return new InMemoryKnowledgeStore().capabilities();
      }
    }

    enqueueEpisodicSignal(runtime, {
      id: "sig-fail-1",
      content: "Must survive write failure.",
      scope: "project",
      projectRef: "ai-memory",
      source: { surface: "cursor", harness: "cursor", captured_at: "2026-05-24T12:00:00.000Z" },
    });

    assert.throws(() => consolidateNow(runtime, new FailingKnowledgeStore()), /knowledge write failed/);

    const remaining = runtime.queuePeek();
    assert.equal(remaining?.id, "sig-fail-1");
    assert.equal(remaining?.payload.content, "Must survive write failure.");
  });

  it("rejects project-scoped signals missing projectRef", () => {
    runtime.queueRemoveIds(runtime.queueList().map((item) => item.id));

    enqueueEpisodicSignal(runtime, {
      id: "sig-missing-ref",
      content: "Missing project ref.",
      scope: "project",
      source: { surface: "cursor", harness: "cursor", captured_at: "2026-05-24T12:00:00.000Z" },
    });

    assert.throws(
      () => consolidateNow(runtime, knowledge),
      (error: unknown) => error instanceof AmpError && error.message === "project scope requires projectRef"
    );
    assert.equal(runtime.queuePeek()?.id, "sig-missing-ref");
  });
});
