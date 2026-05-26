import { describe, it } from "node:test";
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
import {
  buildProjectionDocuments,
  buildProjectionDocumentsWithReport,
} from "./build-documents.js";
import { LocalProjectionSource } from "./local-source.js";
import type { ProjectionDocument } from "./schema.js";

const ISO = "2026-05-26T12:00:00.000Z";
const PROJECT_REF = "demo-app";
const GENERATED_AT = "2026-05-25T12:00:00.000Z";

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

interface LocalProjectionFixture {
  runtime: RuntimeStore;
  knowledge: InMemoryKnowledgeStore;
}

async function createLocalProjectionFixture(): Promise<{
  fixture: LocalProjectionFixture;
  dispose: () => Promise<void>;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), "amp-local-projection-source-"));
  const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
  const knowledge = new InMemoryKnowledgeStore();

  return {
    fixture: { runtime, knowledge },
    dispose: async () => {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

function preferenceSource(): InMemoryRuntimeSemanticEntitySource {
  return new InMemoryRuntimeSemanticEntitySource([
    {
      id: "pref-1",
      kind: "runtime-preference-candidate",
      scope: "user",
      payload: activePreference,
    } satisfies RuntimeSemanticEntityRecord,
  ]);
}

function invalidTypedRuntimeSource(
  projectRef: string,
): InMemoryRuntimeSemanticEntitySource {
  return new InMemoryRuntimeSemanticEntitySource([
    {
      id: "dec-invalid",
      kind: "unresolved-decision",
      scope: "project",
      project_ref: projectRef,
      payload: { id: "dec-invalid" },
    } satisfies RuntimeSemanticEntityRecord,
  ]);
}

function assertDocumentsOnly(
  documents: ProjectionDocument[],
): asserts documents is ProjectionDocument[] {
  assert.ok(Array.isArray(documents));
  for (const document of documents) {
    assert.equal(typeof document.metadata.kind, "string");
    assert.equal(typeof document.body, "string");
  }
  assert.equal(
    Object.prototype.hasOwnProperty.call(documents, "report"),
    false,
    "ProjectionSource.loadProjectionDocuments must not attach a build report",
  );
}

describe("LocalProjectionSource", () => {
  it("exposes local sourceKind and supports apply", async () => {
    const { fixture, dispose } = await createLocalProjectionFixture();
    try {
      const source = new LocalProjectionSource({
        knowledge: fixture.knowledge,
        runtime: fixture.runtime,
        projectRef: "demo",
      });
      assert.equal(source.sourceKind, "local");
      assert.equal(source.supportsApply, true);
    } finally {
      await dispose();
    }
  });

  it("loads four projection documents from knowledge and runtime stores", async () => {
    const { fixture, dispose } = await createLocalProjectionFixture();
    try {
      fixture.knowledge.write([
        createFrame({
          id: "project-pref",
          kind: "semantic",
          content: "Use conventional commits in this repo.",
          source: { surface: "cursor" },
          created_at: "2026-05-25T00:00:00.000Z",
          scope: { kind: "project", project_ref: PROJECT_REF },
          curation_mode: "personal",
        }),
      ]);
      capturePreference(fixture.runtime, {
        content: "Queued project runtime note.",
        scope: "project",
        projectRef: PROJECT_REF,
      });

      const source = new LocalProjectionSource({
        knowledge: fixture.knowledge,
        runtime: fixture.runtime,
        projectRef: PROJECT_REF,
        generatedAt: GENERATED_AT,
      });
      const documents = source.loadProjectionDocuments({ projectRef: PROJECT_REF });

      assert.equal(documents.length, 4);
      const projectProjection = documents.find((doc) => doc.metadata.kind === "project_projection");
      const projectRuntime = documents.find((doc) => doc.metadata.kind === "project_runtime");
      assert.match(projectProjection?.body ?? "", /Use conventional commits in this repo\./);
      assert.match(projectRuntime?.body ?? "", /Queued project runtime note\./);
    } finally {
      await dispose();
    }
  });

  it("does not write to the filesystem", async () => {
    const { fixture, dispose } = await createLocalProjectionFixture();
    try {
      const source = new LocalProjectionSource({
        knowledge: fixture.knowledge,
        runtime: fixture.runtime,
        projectRef: PROJECT_REF,
      });
      const documents = source.loadProjectionDocuments({ projectRef: PROJECT_REF });
      assert.equal(documents.length, 4);
    } finally {
      await dispose();
    }
  });

  it("matches direct buildProjectionDocuments output when runtimeSemanticSource is omitted", async () => {
    const { fixture, dispose } = await createLocalProjectionFixture();
    try {
      const source = new LocalProjectionSource({
        knowledge: fixture.knowledge,
        runtime: fixture.runtime,
        projectRef: PROJECT_REF,
        generatedAt: GENERATED_AT,
      });
      const expected = buildProjectionDocuments({
        frames: fixture.knowledge.list(),
        runtimeItems: fixture.runtime.queueList(),
        projectRef: PROJECT_REF,
        generatedAt: GENERATED_AT,
        revisionPrefix: "local",
      });

      assert.deepEqual(source.loadProjectionDocuments({ projectRef: PROJECT_REF }), expected);
    } finally {
      await dispose();
    }
  });

  it("includes injected typed runtime semantics in loaded runtime documents", async () => {
    const { fixture, dispose } = await createLocalProjectionFixture();
    try {
      const source = new LocalProjectionSource({
        knowledge: fixture.knowledge,
        runtime: fixture.runtime,
        projectRef: PROJECT_REF,
        generatedAt: GENERATED_AT,
        runtimeSemanticSource: preferenceSource(),
      });
      const documents = source.loadProjectionDocuments({ projectRef: PROJECT_REF });
      const globalRuntime = documents.find((doc) => doc.metadata.kind === "global_runtime");

      assert.match(globalRuntime?.body ?? "", /Typed runtime semantics \(runtime-preference-candidate\)/);
      assert.match(globalRuntime?.body ?? "", /Keep responses short today/);
      assert.equal(globalRuntime?.metadata.source_revision, "rev-local-pref-1");
    } finally {
      await dispose();
    }
  });

  it("returns documents only when typed runtime records are skipped (report via buildProjectionDocumentsWithReport)", async () => {
    const { fixture, dispose } = await createLocalProjectionFixture();
    try {
      const runtimeSemanticSource = invalidTypedRuntimeSource(PROJECT_REF);
      const buildOptions = {
        frames: fixture.knowledge.list(),
        runtimeItems: fixture.runtime.queueList(),
        projectRef: PROJECT_REF,
        generatedAt: GENERATED_AT,
        revisionPrefix: "local" as const,
        runtimeSemanticSource,
      };

      const source = new LocalProjectionSource({
        knowledge: fixture.knowledge,
        runtime: fixture.runtime,
        projectRef: PROJECT_REF,
        generatedAt: GENERATED_AT,
        runtimeSemanticSource,
      });
      const documents = source.loadProjectionDocuments({ projectRef: PROJECT_REF });

      assertDocumentsOnly(documents);
      assert.equal(documents.length, 4);

      const projectRuntime = documents.find((doc) => doc.metadata.kind === "project_runtime");
      assert.doesNotMatch(projectRuntime?.body ?? "", /Typed runtime semantics/);
      assert.doesNotMatch(projectRuntime?.body ?? "", /dec-invalid/);
      assert.equal(projectRuntime?.metadata.source_revision, "rev-local-empty");

      const withReport = buildProjectionDocumentsWithReport(buildOptions);
      assert.deepEqual(documents, withReport.documents);
      assert.equal(withReport.report.runtimeSemanticSkippedCount, 1);
      assert.deepEqual(
        withReport.report.runtimeSemanticSkipped.map((entry) => entry.recordId),
        ["dec-invalid"],
      );
      assert.deepEqual(
        withReport.report.runtimeSemanticSkipped.map((entry) => entry.reason),
        ["invalid_input"],
      );
    } finally {
      await dispose();
    }
  });
});
