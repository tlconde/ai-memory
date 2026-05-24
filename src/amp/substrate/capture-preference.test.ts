import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { createFrame } from "../core/frame-schema.js";
import { capturePreference } from "./capture-preference.js";
import { consolidateNow } from "./storage/consolidation-minimal.js";
import { retrievePreference } from "./retrieve-preference.js";
import { RuntimeStore } from "./storage/runtime-store.js";

describe("capturePreference", () => {
  let tempDir = "";
  let runtime: RuntimeStore;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "amp-capture-test-"));
    runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
  });

  after(async () => {
    runtime.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("enqueues a project-scoped preference signal", () => {
    const result = capturePreference(runtime, {
      content: "Use conventional commits.",
      scope: "project",
      projectRef: "ai-memory",
    });
    assert.equal(result.queued, true);
    assert.equal(runtime.queuePeek()?.payload.content, "Use conventional commits.");
  });

  it("throws AmpError when project scope lacks projectRef", () => {
    assert.throws(
      () =>
        capturePreference(runtime, {
          content: "Missing project ref.",
          scope: "project",
        }),
      (error: unknown) =>
        error instanceof Error &&
        error.name === "AmpError" &&
        error.message === "project scope requires projectRef"
    );
  });
});

describe("retrievePreference", () => {
  it("reads consolidated preference from knowledge store", () => {
    const knowledge = new InMemoryKnowledgeStore();
    knowledge.write([
      createFrame({
        id: "frame-1",
        kind: "semantic",
        content: "Use conventional commits.",
        source: { surface: "cursor", harness: "cursor" },
        created_at: "2026-05-24T12:00:00.000Z",
        scope: { kind: "project", project_ref: "ai-memory" },
        curation_mode: "personal",
      }),
    ]);

    const result = retrievePreference(knowledge, {
      scope: "project",
      projectRef: "ai-memory",
      query: "conventional",
    });

    assert.equal(result?.frame.content, "Use conventional commits.");
  });
});

describe("capture → consolidate → retrieve", () => {
  let tempDir = "";
  let runtime: RuntimeStore;
  let knowledge: InMemoryKnowledgeStore;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "amp-flow-test-"));
    runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    knowledge = new InMemoryKnowledgeStore();
  });

  after(async () => {
    runtime.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("moves preference from runtime queue to retrievable knowledge frame", () => {
    capturePreference(runtime, {
      content: "Never force-push to main.",
      scope: "project",
      projectRef: "ai-memory",
    });
    consolidateNow(runtime, knowledge);

    const retrieved = retrievePreference(knowledge, {
      scope: "project",
      projectRef: "ai-memory",
      query: "force-push",
    });

    assert.equal(retrieved?.frame.content, "Never force-push to main.");
    assert.equal(retrieved?.frame.scope.kind, "project");
    assert.equal(runtime.queuePeek(), undefined);
  });
});
