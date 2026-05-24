import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { CursorAdapter } from "../adapters/sas/cursor/adapter.js";
import { PathSafetyError } from "../path-safety/guard.js";
import { capturePreference } from "../substrate/capture-preference.js";
import { consolidateNow } from "../substrate/storage/consolidation-minimal.js";
import { retrievePreference } from "../substrate/retrieve-preference.js";
import { RuntimeStore } from "../substrate/storage/runtime-store.js";

describe("AMP vertical slice E2E", () => {
  let tempDir = "";
  let projectRoot = "";
  let runtime: RuntimeStore;
  let knowledge: InMemoryKnowledgeStore;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "amp-e2e-"));
    projectRoot = join(tempDir, "project");
    runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    knowledge = new InMemoryKnowledgeStore();
  });

  after(async () => {
    runtime.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("Cursor-style scoped preference → runtime → consolidation → Claude Code-style retrieval", () => {
    const preference = "Prefer explicit return types on exported AMP functions.";

    capturePreference(runtime, {
      content: preference,
      scope: "project",
      projectRef: "ai-memory",
      surface: "cursor",
    });

    assert.ok(runtime.queuePeek(), "preference should be queued in runtime");

    const consolidation = consolidateNow(runtime, knowledge);
    assert.equal(consolidation.processed, 1);
    assert.equal(runtime.queuePeek(), undefined, "runtime queue should be drained");

    const retrieved = retrievePreference(knowledge, {
      scope: "project",
      projectRef: "ai-memory",
    });

    assert.equal(retrieved?.frame.content, preference);
    assert.equal(retrieved?.frame.curation_mode, "personal");
    assert.equal(retrieved?.frame.source.surface, "cursor");
  });

  it("Cursor from-amp path guard rejects escape while E2E knowledge path succeeds", () => {
    const adapter = new CursorAdapter({ projectRoot });
    assert.throws(
      () => adapter.resolveWritePath("../rules/USER_AUTHORED.mdc"),
      PathSafetyError
    );
  });
});
