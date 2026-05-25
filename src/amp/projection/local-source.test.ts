import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { createFrame } from "../core/frame-schema.js";
import { capturePreference } from "../substrate/capture-preference.js";
import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { LocalProjectionSource } from "./local-source.js";
import { estimateProjectionTextTokens } from "./content.js";

describe("LocalProjectionSource", () => {
  let tempDir = "";
  let runtime: RuntimeStore;
  let knowledge: InMemoryKnowledgeStore;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "amp-local-projection-source-"));
    runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    knowledge = new InMemoryKnowledgeStore();
  });

  after(async () => {
    runtime.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("exposes local sourceKind and supports apply", () => {
    const source = new LocalProjectionSource({ knowledge, runtime, projectRef: "demo" });
    assert.equal(source.sourceKind, "local");
    assert.equal(source.supportsApply, true);
  });

  it("includes in-memory knowledge frames in project/global projection bodies by scope", () => {
    knowledge.write([
      createFrame({
        id: "global-pref",
        kind: "semantic",
        content: "Prefer explicit return types globally.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "user" },
        curation_mode: "personal",
      }),
      createFrame({
        id: "project-pref",
        kind: "semantic",
        content: "Use conventional commits in this repo.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "project", project_ref: "demo-app" },
        curation_mode: "personal",
      }),
      createFrame({
        id: "other-project",
        kind: "semantic",
        content: "Should not appear.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "project", project_ref: "other-app" },
        curation_mode: "personal",
      }),
    ]);

    const source = new LocalProjectionSource({
      knowledge,
      runtime,
      projectRef: "demo-app",
      generatedAt: "2026-05-25T12:00:00.000Z",
    });
    const documents = source.loadProjectionDocuments({ projectRef: "demo-app" });

    const globalProjection = documents.find((doc) => doc.metadata.kind === "global_projection");
    const projectProjection = documents.find((doc) => doc.metadata.kind === "project_projection");

    assert.match(globalProjection?.body ?? "", /Prefer explicit return types globally\./);
    assert.match(projectProjection?.body ?? "", /Use conventional commits in this repo\./);
    assert.doesNotMatch(projectProjection?.body ?? "", /Should not appear\./);
    assert.equal(
      globalProjection?.metadata.budget.token_count,
      estimateProjectionTextTokens("Prefer explicit return types globally.")
    );
    assert.equal(
      projectProjection?.metadata.budget.token_count,
      estimateProjectionTextTokens("Use conventional commits in this repo.")
    );
  });

  it("includes runtime queue items in project/global runtime bodies by scope", () => {
    capturePreference(runtime, {
      content: "Queued project runtime note.",
      scope: "project",
      projectRef: "demo-app",
    });
    capturePreference(runtime, {
      content: "Queued global runtime note.",
      scope: "user",
    });

    const source = new LocalProjectionSource({
      knowledge,
      runtime,
      projectRef: "demo-app",
      generatedAt: "2026-05-25T12:00:00.000Z",
    });
    const documents = source.loadProjectionDocuments({ projectRef: "demo-app" });

    const globalRuntime = documents.find((doc) => doc.metadata.kind === "global_runtime");
    const projectRuntime = documents.find((doc) => doc.metadata.kind === "project_runtime");

    assert.match(globalRuntime?.body ?? "", /Queued global runtime note\./);
    assert.match(projectRuntime?.body ?? "", /Queued project runtime note\./);
    assert.ok((globalRuntime?.metadata.budget.token_count ?? 0) > 0);
    assert.ok((projectRuntime?.metadata.budget.token_count ?? 0) > 0);
  });

  it("produces valid documents from empty stores", () => {
    const emptyRuntime = new RuntimeStore({ dbPath: join(tempDir, "empty-runtime.db") });
    const emptyKnowledge = new InMemoryKnowledgeStore();
    try {
      const source = new LocalProjectionSource({
        knowledge: emptyKnowledge,
        runtime: emptyRuntime,
        projectRef: "empty-app",
        generatedAt: "2026-05-25T12:00:00.000Z",
      });
      const documents = source.loadProjectionDocuments({ projectRef: "empty-app" });

      assert.equal(documents.length, 4);
      for (const document of documents) {
        assert.match(document.body, /\S/);
        assert.equal(document.metadata.budget.token_count, 0);
        assert.equal(document.metadata.budget.status, "ok");
      }
    } finally {
      emptyRuntime.close();
    }
  });

  it("routes universal scope frames and runtime items to global sections", () => {
    knowledge.write([
      createFrame({
        id: "universal-pref",
        kind: "semantic",
        content: "Universal durable preference.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "universal" },
        curation_mode: "personal",
      }),
    ]);
    capturePreference(runtime, {
      content: "Universal runtime note.",
      scope: "universal",
    });

    const source = new LocalProjectionSource({
      knowledge,
      runtime,
      projectRef: "demo-app",
      generatedAt: "2026-05-25T12:00:00.000Z",
    });
    const documents = source.loadProjectionDocuments({ projectRef: "demo-app" });

    const globalProjection = documents.find((doc) => doc.metadata.kind === "global_projection");
    const globalRuntime = documents.find((doc) => doc.metadata.kind === "global_runtime");

    assert.match(globalProjection?.body ?? "", /Universal durable preference\./);
    assert.match(globalRuntime?.body ?? "", /Universal runtime note\./);
  });

  it("excludes mismatched project scope from project sections", () => {
    knowledge.write([
      createFrame({
        id: "wrong-project-frame",
        kind: "semantic",
        content: "Wrong project frame.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "project", project_ref: "other-app" },
        curation_mode: "personal",
      }),
    ]);
    capturePreference(runtime, {
      content: "Wrong project runtime.",
      scope: "project",
      projectRef: "other-app",
    });

    const source = new LocalProjectionSource({
      knowledge,
      runtime,
      projectRef: "demo-app",
      generatedAt: "2026-05-25T12:00:00.000Z",
    });
    const documents = source.loadProjectionDocuments({ projectRef: "demo-app" });

    const projectProjection = documents.find((doc) => doc.metadata.kind === "project_projection");
    const projectRuntime = documents.find((doc) => doc.metadata.kind === "project_runtime");

    assert.doesNotMatch(projectProjection?.body ?? "", /Wrong project frame\./);
    assert.doesNotMatch(projectRuntime?.body ?? "", /Wrong project runtime\./);
  });

  it("does not write to the filesystem", () => {
    const source = new LocalProjectionSource({ knowledge, runtime, projectRef: "demo-app" });
    const documents = source.loadProjectionDocuments({ projectRef: "demo-app" });
    assert.equal(documents.length, 4);
  });
});
