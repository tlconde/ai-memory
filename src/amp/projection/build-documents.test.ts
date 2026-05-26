import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFrame } from "../core/frame-schema.js";
import { capturePreference } from "../substrate/capture-preference.js";
import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import {
  InMemoryRuntimeSemanticEntitySource,
  type RuntimeSemanticEntityRecord,
} from "../runtime-semantics/projection-source.js";
import {
  buildProjectionDocuments,
  buildProjectionDocumentsWithReport,
} from "./build-documents.js";
import { estimateProjectionTextTokens } from "./content.js";

const ISO = "2026-05-26T12:00:00.000Z";
const PROJECT_REF = "demo-app";

const typedRuntimeFixtures = {
  activePreference: {
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
  },
  openDecision: {
    id: "dec-1",
    question: "Which storage backend?",
    status: "open" as const,
    scope: "project" as const,
    options: [
      {
        id: "opt-1",
        label: "SQLite",
        tradeoffs: ["local only"],
        evidence_refs: ["evidence-1"],
      },
    ],
    urgency: "medium" as const,
    owner: "user" as const,
    created_at: ISO,
    last_touched_at: ISO,
    provenance: ["signal-1"],
  },
  secretEpisodicFrame: {
    id: "frame-secret",
    event_type: "correction" as const,
    summary: "Contains secret-token in summary",
    details: { token: "secret-token" },
    tags: ["storage"],
    scope: "user" as const,
    curation_mode: "personal" as const,
    occurred_at: ISO,
    recorded_at: ISO,
    source_signals: ["signal-5"],
    related_entities: {},
    evidence_refs: ["evidence-1"],
    provenance: {
      transform_id: "frame-v1",
    },
    confidence: "high" as const,
    source: "user_explicit" as const,
    sensitivity: "secret_redacted" as const,
    visibility: "user_private" as const,
    pinned: false,
    lifecycle_state: "active" as const,
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
      payload: typedRuntimeFixtures.activePreference,
    }),
  ]);
}

describe("buildProjectionDocuments", () => {
  it("routes project-scoped knowledge frames to project projection", () => {
    const documents = buildProjectionDocuments({
      frames: [
        createFrame({
          id: "project-pref",
          kind: "semantic",
          content: "Use conventional commits in this repo.",
          source: { surface: "cursor" },
          created_at: "2026-05-25T00:00:00.000Z",
          scope: { kind: "project", project_ref: "demo-app" },
          curation_mode: "personal",
        }),
      ],
      runtimeItems: [],
      projectRef: "demo-app",
      generatedAt: "2026-05-25T12:00:00.000Z",
      revisionPrefix: "local",
    });

    const projectProjection = documents.find((doc) => doc.metadata.kind === "project_projection");
    assert.match(projectProjection?.body ?? "", /Use conventional commits in this repo\./);
    assert.equal(
      projectProjection?.metadata.budget.token_count,
      estimateProjectionTextTokens("Use conventional commits in this repo.")
    );
  });

  it("routes user and universal frames to global projection", () => {
    const documents = buildProjectionDocuments({
      frames: [
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
          id: "universal-pref",
          kind: "semantic",
          content: "Universal durable preference.",
          source: { surface: "cursor" },
          created_at: "2026-05-25T00:00:00.000Z",
          scope: { kind: "universal" },
          curation_mode: "personal",
        }),
      ],
      runtimeItems: [],
      projectRef: "demo-app",
      generatedAt: "2026-05-25T12:00:00.000Z",
      revisionPrefix: "local",
    });

    const globalProjection = documents.find((doc) => doc.metadata.kind === "global_projection");
    assert.match(globalProjection?.body ?? "", /Prefer explicit return types globally\./);
    assert.match(globalProjection?.body ?? "", /Universal durable preference\./);
  });

  it("excludes mismatched project frames from project sections", () => {
    const documents = buildProjectionDocuments({
      frames: [
        createFrame({
          id: "wrong-project-frame",
          kind: "semantic",
          content: "Wrong project frame.",
          source: { surface: "cursor" },
          created_at: "2026-05-25T00:00:00.000Z",
          scope: { kind: "project", project_ref: "other-app" },
          curation_mode: "personal",
        }),
      ],
      runtimeItems: [],
      projectRef: "demo-app",
      generatedAt: "2026-05-25T12:00:00.000Z",
      revisionPrefix: "local",
    });

    const projectProjection = documents.find((doc) => doc.metadata.kind === "project_projection");
    assert.doesNotMatch(projectProjection?.body ?? "", /Wrong project frame\./);
  });

  it("routes runtime queue items to scoped runtime sections", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-build-documents-runtime-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      capturePreference(runtime, {
        content: "Queued project runtime note.",
        scope: "project",
        projectRef: "demo-app",
      });
      capturePreference(runtime, {
        content: "Queued global runtime note.",
        scope: "user",
      });

      const documents = buildProjectionDocuments({
        frames: [],
        runtimeItems: runtime.queueList(),
        projectRef: "demo-app",
        generatedAt: "2026-05-25T12:00:00.000Z",
        revisionPrefix: "local",
      });

      const globalRuntime = documents.find((doc) => doc.metadata.kind === "global_runtime");
      const projectRuntime = documents.find((doc) => doc.metadata.kind === "project_runtime");

      assert.match(globalRuntime?.body ?? "", /Queued global runtime note\./);
      assert.match(projectRuntime?.body ?? "", /Queued project runtime note\./);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("produces valid documents from empty stores", () => {
    const documents = buildProjectionDocuments({
      frames: [],
      runtimeItems: [],
      projectRef: "empty-app",
      generatedAt: "2026-05-25T12:00:00.000Z",
      revisionPrefix: "local",
    });

    assert.equal(documents.length, 4);
    for (const document of documents) {
      assert.match(document.body, /\S/);
      assert.equal(document.metadata.budget.token_count, 0);
      assert.equal(document.metadata.budget.status, "ok");
      assert.equal(document.metadata.source_revision, "rev-local-empty");
    }
  });

  it("uses stable revision prefixes per source kind", () => {
    const frame = createFrame({
      id: "rev-frame",
      kind: "semantic",
      content: "Revision probe.",
      source: { surface: "cursor" },
      created_at: "2026-05-25T00:00:00.000Z",
      scope: { kind: "user" },
      curation_mode: "personal",
    });

    const localDocs = buildProjectionDocuments({
      frames: [frame],
      runtimeItems: [],
      projectRef: "demo-app",
      generatedAt: "2026-05-25T12:00:00.000Z",
      revisionPrefix: "local",
    });
    const gbrainDocs = buildProjectionDocuments({
      frames: [frame],
      runtimeItems: [],
      projectRef: "demo-app",
      generatedAt: "2026-05-25T12:00:00.000Z",
      revisionPrefix: "gbrain",
    });

    const localGlobal = localDocs.find((doc) => doc.metadata.kind === "global_projection");
    const gbrainGlobal = gbrainDocs.find((doc) => doc.metadata.kind === "global_projection");

    assert.equal(localGlobal?.metadata.source_revision, "rev-local-rev-frame");
    assert.equal(gbrainGlobal?.metadata.source_revision, "rev-gbrain-rev-frame");
  });

  it("preserves current output when no typed runtime source is provided", () => {
    const withoutTyped = buildProjectionDocuments({
      frames: [],
      runtimeItems: [],
      projectRef: PROJECT_REF,
      generatedAt: "2026-05-25T12:00:00.000Z",
      revisionPrefix: "local",
    });
    const withUndefinedTyped = buildProjectionDocuments({
      frames: [],
      runtimeItems: [],
      projectRef: PROJECT_REF,
      generatedAt: "2026-05-25T12:00:00.000Z",
      revisionPrefix: "local",
      runtimeSemanticSource: undefined,
    });

    assert.deepEqual(withUndefinedTyped, withoutTyped);
    const emptyReport = buildProjectionDocumentsWithReport({
      frames: [],
      runtimeItems: [],
      projectRef: PROJECT_REF,
      generatedAt: "2026-05-25T12:00:00.000Z",
      revisionPrefix: "local",
    }).report;
    assert.equal(emptyReport.runtimeSemanticMaterializedCount, 0);
    assert.equal(emptyReport.runtimeSemanticSkippedCount, 0);
    assert.deepEqual(emptyReport.runtimeSemanticSkipped, []);
  });

  it("routes user-scoped typed preferences to global runtime", () => {
    const { documents, report } = buildProjectionDocumentsWithReport({
      frames: [],
      runtimeItems: [],
      projectRef: PROJECT_REF,
      generatedAt: "2026-05-25T12:00:00.000Z",
      revisionPrefix: "local",
      runtimeSemanticSource: preferenceSource(),
    });

    const globalRuntime = documents.find((doc) => doc.metadata.kind === "global_runtime");
    const projectRuntime = documents.find((doc) => doc.metadata.kind === "project_runtime");

    assert.match(globalRuntime?.body ?? "", /Typed runtime semantics \(runtime-preference-candidate\)/);
    assert.match(globalRuntime?.body ?? "", /Keep responses short today/);
    assert.doesNotMatch(projectRuntime?.body ?? "", /Keep responses short today/);
    assert.equal(report.runtimeSemanticMaterializedCount, 1);
    assert.equal(report.runtimeSemanticSkippedCount, 0);
    assert.ok((globalRuntime?.metadata.budget.token_count ?? 0) > 0);
  });

  it("routes project-scoped unresolved decisions to project runtime", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      runtimeRecord({
        id: "dec-1",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: PROJECT_REF,
        payload: typedRuntimeFixtures.openDecision,
      }),
    ]);

    const { documents } = buildProjectionDocumentsWithReport({
      frames: [],
      runtimeItems: [],
      projectRef: PROJECT_REF,
      generatedAt: "2026-05-25T12:00:00.000Z",
      revisionPrefix: "local",
      runtimeSemanticSource: source,
    });

    const projectRuntime = documents.find((doc) => doc.metadata.kind === "project_runtime");
    const globalRuntime = documents.find((doc) => doc.metadata.kind === "global_runtime");

    assert.match(projectRuntime?.body ?? "", /Typed runtime semantics \(unresolved-decision\)/);
    assert.match(projectRuntime?.body ?? "", /Which storage backend/);
    assert.doesNotMatch(globalRuntime?.body ?? "", /Which storage backend/);
  });

  it("does not leak secret_redacted episodic frame summary or details", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      runtimeRecord({
        id: "frame-secret",
        kind: "episodic-frame",
        scope: "user",
        payload: typedRuntimeFixtures.secretEpisodicFrame,
      }),
    ]);

    const { documents } = buildProjectionDocumentsWithReport({
      frames: [],
      runtimeItems: [],
      projectRef: PROJECT_REF,
      generatedAt: "2026-05-25T12:00:00.000Z",
      revisionPrefix: "local",
      runtimeSemanticSource: source,
    });

    const globalRuntime = documents.find((doc) => doc.metadata.kind === "global_runtime")?.body ?? "";
    assert.match(globalRuntime, /secret_redacted/i);
    assert.doesNotMatch(globalRuntime, /secret-token/);
    assert.doesNotMatch(globalRuntime, /Contains secret-token in summary/);
  });

  it("surfaces skipped typed runtime records and report counts in the build report", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      runtimeRecord({
        id: "dec-invalid",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: PROJECT_REF,
        payload: { id: "dec-invalid" },
      }),
      runtimeRecord({
        id: "lean-orphan",
        kind: "current-decision-leaning",
        scope: "project",
        project_ref: PROJECT_REF,
        payload: {
          decision_id: "missing-parent",
          option_id: "opt-1",
          observed_at: ISO,
          source_signal_id: "signal-lean-1",
          freshness: "fresh" as const,
        },
      }),
    ]);

    const { report } = buildProjectionDocumentsWithReport({
      frames: [],
      runtimeItems: [],
      projectRef: PROJECT_REF,
      generatedAt: "2026-05-25T12:00:00.000Z",
      revisionPrefix: "local",
      runtimeSemanticSource: source,
    });

    assert.deepEqual(
      report.runtimeSemanticSkipped.map((entry) => entry.recordId),
      ["dec-invalid", "lean-orphan"],
    );
    assert.deepEqual(
      report.runtimeSemanticSkipped.map((entry) => entry.reason),
      ["invalid_input", "orphan_sub_entity"],
    );
    assert.equal(report.runtimeSemanticMaterializedCount, 0);
    assert.equal(report.runtimeSemanticSkippedCount, 2);
  });

  it("includes typed runtime semantic block IDs in runtime source_revision", () => {
    const { documents } = buildProjectionDocumentsWithReport({
      frames: [],
      runtimeItems: [],
      projectRef: PROJECT_REF,
      generatedAt: "2026-05-25T12:00:00.000Z",
      revisionPrefix: "local",
      runtimeSemanticSource: preferenceSource(),
    });

    const globalRuntime = documents.find((doc) => doc.metadata.kind === "global_runtime");
    const projectRuntime = documents.find((doc) => doc.metadata.kind === "project_runtime");

    assert.equal(globalRuntime?.metadata.source_revision, "rev-local-pref-1");
    assert.equal(projectRuntime?.metadata.source_revision, "rev-local-empty");
  });

  it("includes raw queue and typed runtime semantic IDs in runtime source_revision", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-build-documents-typed-runtime-revision-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      capturePreference(runtime, {
        content: "Queued global runtime note.",
        scope: "user",
      });

      const queueItems = runtime.queueList();
      const rawQueueId = queueItems[0]?.id;
      assert.ok(rawQueueId);

      const { documents } = buildProjectionDocumentsWithReport({
        frames: [],
        runtimeItems: queueItems,
        projectRef: PROJECT_REF,
        generatedAt: "2026-05-25T12:00:00.000Z",
        revisionPrefix: "local",
        runtimeSemanticSource: preferenceSource(),
      });

      const globalRuntime = documents.find((doc) => doc.metadata.kind === "global_runtime");
      assert.equal(
        globalRuntime?.metadata.source_revision,
        `rev-local-${rawQueueId}|pref-1`,
      );
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("renders raw runtime queue content before typed semantic blocks", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-build-documents-typed-runtime-order-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      capturePreference(runtime, {
        content: "Queued global runtime note.",
        scope: "user",
      });

      const source = preferenceSource();

      const { documents } = buildProjectionDocumentsWithReport({
        frames: [],
        runtimeItems: runtime.queueList(),
        projectRef: PROJECT_REF,
        generatedAt: "2026-05-25T12:00:00.000Z",
        revisionPrefix: "local",
        runtimeSemanticSource: source,
      });

      const globalRuntime = documents.find((doc) => doc.metadata.kind === "global_runtime")?.body ?? "";
      const rawIndex = globalRuntime.indexOf("Queued global runtime note.");
      const typedIndex = globalRuntime.indexOf("Typed runtime semantics (runtime-preference-candidate)");

      assert.notEqual(rawIndex, -1);
      assert.notEqual(typedIndex, -1);
      assert.ok(rawIndex < typedIndex);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
