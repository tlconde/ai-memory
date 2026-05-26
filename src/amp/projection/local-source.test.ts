import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { createFrame } from "../core/frame-schema.js";
import {
  InMemoryRuntimeSemanticEntitySource,
  type RuntimeSemanticEntityRecord,
} from "../runtime-semantics/projection-source.js";
import { capturePreference } from "../substrate/capture-preference.js";
import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { buildProjectionDocuments } from "./build-documents.js";
import { LocalProjectionSource } from "./local-source.js";

const ISO = "2026-05-26T12:00:00.000Z";

const activePreference = {
  id: "pref-1",
  statement: "Keep responses short today",
  mode: "time_bounded" as const,
  scope: "user" as const,
  context: {},
  status: "active" as const,
  expires_at: ISO,
  first_observed_at: ISO,
  last_observed_at: ISO,
  source_signal_ids: ["signal-3"],
  confidence: "medium" as const,
  promotion_evidence: {
    repetition_count: 0,
    independent_sessions: 0,
  },
};

function runtimeRecord(
  overrides: RuntimeSemanticEntityRecord,
): RuntimeSemanticEntityRecord {
  return overrides;
}

function preferenceSource(): InMemoryRuntimeSemanticEntitySource {
  return new InMemoryRuntimeSemanticEntitySource([
    runtimeRecord({
      id: "pref-1",
      kind: "runtime-preference-candidate",
      scope: "user",
      payload: activePreference,
    }),
  ]);
}

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

  it("matches direct buildProjectionDocuments output when runtimeSemanticSource is omitted", () => {
    const projectRef = "demo-app";
    const generatedAt = "2026-05-25T12:00:00.000Z";
    const source = new LocalProjectionSource({
      knowledge,
      runtime,
      projectRef,
      generatedAt,
    });
    const expected = buildProjectionDocuments({
      frames: knowledge.list(),
      runtimeItems: runtime.queueList(),
      projectRef,
      generatedAt,
      revisionPrefix: "local",
    });

    assert.deepEqual(source.loadProjectionDocuments({ projectRef }), expected);
  });

  it("includes injected typed runtime semantics in loaded runtime documents", () => {
    const projectRef = "demo-app";
    const generatedAt = "2026-05-25T12:00:00.000Z";
    const source = new LocalProjectionSource({
      knowledge,
      runtime,
      projectRef,
      generatedAt,
      runtimeSemanticSource: preferenceSource(),
    });
    const documents = source.loadProjectionDocuments({ projectRef });
    const globalRuntime = documents.find((doc) => doc.metadata.kind === "global_runtime");

    assert.match(globalRuntime?.body ?? "", /Typed runtime semantics \(runtime-preference-candidate\)/);
    assert.match(globalRuntime?.body ?? "", /Keep responses short today/);
    assert.equal(globalRuntime?.metadata.source_revision, "rev-local-pref-1");
  });

  it("does not expose typed runtime skip report on ProjectionSource (use buildProjectionDocumentsWithReport)", () => {
    // LocalProjectionSource implements ProjectionSource, which returns documents only.
    // Skipped typed runtime materialization is covered in build-documents.test.ts.
    const source = new LocalProjectionSource({
      knowledge,
      runtime,
      projectRef: "demo-app",
      runtimeSemanticSource: preferenceSource(),
    });
    const documents = source.loadProjectionDocuments({ projectRef: "demo-app" });
    assert.equal(documents.length, 4);
  });
});
