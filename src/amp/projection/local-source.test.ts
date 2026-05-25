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

  it("loads four projection documents from knowledge and runtime stores", () => {
    knowledge.write([
      createFrame({
        id: "project-pref",
        kind: "semantic",
        content: "Use conventional commits in this repo.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "project", project_ref: "demo-app" },
        curation_mode: "personal",
      }),
    ]);
    capturePreference(runtime, {
      content: "Queued project runtime note.",
      scope: "project",
      projectRef: "demo-app",
    });

    const source = new LocalProjectionSource({
      knowledge,
      runtime,
      projectRef: "demo-app",
      generatedAt: "2026-05-25T12:00:00.000Z",
    });
    const documents = source.loadProjectionDocuments({ projectRef: "demo-app" });

    assert.equal(documents.length, 4);
    const projectProjection = documents.find((doc) => doc.metadata.kind === "project_projection");
    const projectRuntime = documents.find((doc) => doc.metadata.kind === "project_runtime");
    assert.match(projectProjection?.body ?? "", /Use conventional commits in this repo\./);
    assert.match(projectRuntime?.body ?? "", /Queued project runtime note\./);
  });

  it("does not write to the filesystem", () => {
    const source = new LocalProjectionSource({ knowledge, runtime, projectRef: "demo-app" });
    const documents = source.loadProjectionDocuments({ projectRef: "demo-app" });
    assert.equal(documents.length, 4);
  });
});
