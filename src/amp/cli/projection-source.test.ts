import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { LocalSqliteKnowledgeStore } from "../adapters/ssa/local-sqlite-knowledge-store.js";
import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";
import { ReadonlyGbrainMcpTransport } from "../adapters/ssa/gbrain/readonly-transport.js";
import { createFrame } from "../core/frame-schema.js";
import { buildProjectionDocuments } from "../projection/build-documents.js";
import type { ProjectionDocument } from "../projection/schema.js";
import {
  GbrainProjectionSource,
  type GbrainProjectionSourceOptions,
} from "../projection/gbrain-source.js";
import {
  LocalProjectionSource,
  type LocalProjectionSourceOptions,
} from "../projection/local-source.js";
import {
  InMemoryRuntimeSemanticEntitySource,
  type RuntimeSemanticEntityRecord,
} from "../runtime-semantics/projection-source.js";
import {
  RuntimeSemanticStorageEntitySource,
  RuntimeStoreSemanticEntityReader,
  type RuntimeSemanticEntityReader,
} from "../runtime-semantics/storage-source.js";
import { capturePreference } from "../substrate/capture-preference.js";
import { AMP_KNOWLEDGE_BACKEND_ENV, resolveLocalKnowledgeDbPath } from "./knowledge-backend.js";
import { createProjectionRenderSource } from "./projection-source.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const LOCAL_PROJECT_REF = "factory-local-demo";
const PREFERENCE_ISO = "2026-05-26T12:00:00.000Z";

const activePreference = {
  id: "pref-1",
  statement: "Keep responses short today",
  mode: "time_bounded" as const,
  scope: "user" as const,
  context: {},
  status: "active" as const,
  expires_at: PREFERENCE_ISO,
  first_observed_at: PREFERENCE_ISO,
  last_observed_at: PREFERENCE_ISO,
  source_signal_ids: ["signal-3"],
  confidence: "medium" as const,
  promotion_evidence: {
    repetition_count: 0,
    independent_sessions: 0,
  },
};

function gbrainAdapterFromSource(source: GbrainProjectionSource): GbrainKnowledgeAdapter {
  return (source as unknown as { options: GbrainProjectionSourceOptions }).options.adapter;
}

function localOptionsFromSource(source: LocalProjectionSource): LocalProjectionSourceOptions {
  return (source as unknown as { options: LocalProjectionSourceOptions }).options;
}

function storageSourceReaderFromSource(
  source: RuntimeSemanticStorageEntitySource
): RuntimeSemanticEntityReader {
  return (source as unknown as { reader: RuntimeSemanticEntityReader }).reader;
}

function normalizeGeneratedAt(documents: ProjectionDocument[]): ProjectionDocument[] {
  return documents.map((document) => ({
    ...document,
    metadata: {
      ...document.metadata,
      generated_at: "normalized",
    },
  }));
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

describe("createProjectionRenderSource local", () => {
  let tempDir = "";

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "amp-projection-source-local-"));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("preserves queue-only output when runtimeSemanticSource is omitted", () => {
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "local-queue-only-runtime.db") });
    const knowledge = new InMemoryKnowledgeStore();
    try {
      knowledge.write([
        createFrame({
          id: "project-pref",
          kind: "semantic",
          content: "Use conventional commits in this repo.",
          source: { surface: "cursor" },
          created_at: "2026-05-25T00:00:00.000Z",
          scope: { kind: "project", project_ref: LOCAL_PROJECT_REF },
          curation_mode: "personal",
        }),
      ]);
      capturePreference(runtime, {
        content: "Queued project runtime note.",
        scope: "project",
        projectRef: LOCAL_PROJECT_REF,
      });

      const resolved = createProjectionRenderSource({
        sourceKind: "local",
        projectRef: LOCAL_PROJECT_REF,
        runtimeDbPath: join(tempDir, "local-queue-only-runtime.db"),
        knowledgeStore: knowledge,
        env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "in-memory" },
        deps: { openRuntimeStore: () => runtime },
      });

      assert.ok(!("error" in resolved));
      assert.ok(resolved.source instanceof LocalProjectionSource);

      const documents = resolved.source.loadProjectionDocuments({
        projectRef: LOCAL_PROJECT_REF,
      });
      const expected = buildProjectionDocuments({
        frames: knowledge.list(),
        runtimeItems: runtime.queueList(),
        projectRef: LOCAL_PROJECT_REF,
        revisionPrefix: "local",
      });

      assert.deepEqual(normalizeGeneratedAt(documents), normalizeGeneratedAt(expected));
      const projectRuntime = documents.find((doc) => doc.metadata.kind === "project_runtime");
      assert.match(projectRuntime?.body ?? "", /Queued project runtime note\./);
      assert.doesNotMatch(projectRuntime?.body ?? "", /Typed runtime semantics/);
    } finally {
      runtime.close();
    }
  });

  it("wires default RuntimeSemanticStorageEntitySource when runtimeSemanticSource is omitted", () => {
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "local-default-semantic-source.db") });
    const knowledge = new InMemoryKnowledgeStore();
    try {
      const resolved = createProjectionRenderSource({
        sourceKind: "local",
        projectRef: LOCAL_PROJECT_REF,
        runtimeDbPath: join(tempDir, "local-default-semantic-source.db"),
        knowledgeStore: knowledge,
        env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "in-memory" },
        deps: { openRuntimeStore: () => runtime },
      });

      assert.ok(!("error" in resolved));
      const semanticSource = localOptionsFromSource(resolved.source).runtimeSemanticSource;
      assert.ok(semanticSource instanceof RuntimeSemanticStorageEntitySource);

      const reader = storageSourceReaderFromSource(semanticSource);
      assert.ok(reader instanceof RuntimeStoreSemanticEntityReader);
      assert.deepEqual(semanticSource.listEntities(), []);
    } finally {
      runtime.close();
    }
  });

  it("materializes persisted typed entities through default local factory path", () => {
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "local-persisted-typed-runtime.db") });
    const knowledge = new InMemoryKnowledgeStore();
    try {
      runtime.semanticEntityInsert({
        id: "pref-1",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: activePreference,
        observed_at: PREFERENCE_ISO,
      });
      capturePreference(runtime, {
        content: "Queued note stays separate from typed table.",
        scope: "project",
        projectRef: LOCAL_PROJECT_REF,
      });

      const resolved = createProjectionRenderSource({
        sourceKind: "local",
        projectRef: LOCAL_PROJECT_REF,
        runtimeDbPath: join(tempDir, "local-persisted-typed-runtime.db"),
        knowledgeStore: knowledge,
        env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "in-memory" },
        deps: { openRuntimeStore: () => runtime },
      });

      assert.ok(!("error" in resolved));
      const documents = resolved.source.loadProjectionDocuments({
        projectRef: LOCAL_PROJECT_REF,
      });
      const globalRuntime = documents.find((doc) => doc.metadata.kind === "global_runtime");
      const projectRuntime = documents.find((doc) => doc.metadata.kind === "project_runtime");

      assert.match(globalRuntime?.body ?? "", /Keep responses short today/);
      assert.equal(globalRuntime?.metadata.source_revision, "rev-local-pref-1");
      assert.match(projectRuntime?.body ?? "", /Queued note stays separate from typed table\./);
    } finally {
      runtime.close();
    }
  });

  it("passes injected runtimeSemanticSource into LocalProjectionSource", () => {
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "local-typed-runtime.db") });
    const knowledge = new InMemoryKnowledgeStore();
    const runtimeSemanticSource = preferenceSource();
    try {
      const resolved = createProjectionRenderSource({
        sourceKind: "local",
        projectRef: LOCAL_PROJECT_REF,
        runtimeDbPath: join(tempDir, "local-typed-runtime.db"),
        knowledgeStore: knowledge,
        env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "in-memory" },
        runtimeSemanticSource,
        deps: { openRuntimeStore: () => runtime },
      });

      assert.ok(!("error" in resolved));
      assert.ok(resolved.source instanceof LocalProjectionSource);
      const wired = localOptionsFromSource(resolved.source).runtimeSemanticSource;
      assert.equal(wired, runtimeSemanticSource);
      assert.ok(!(wired instanceof RuntimeSemanticStorageEntitySource));

      const documents = resolved.source.loadProjectionDocuments({
        projectRef: LOCAL_PROJECT_REF,
      });
      const globalRuntime = documents.find((doc) => doc.metadata.kind === "global_runtime");

      assert.match(globalRuntime?.body ?? "", /Typed runtime semantics \(runtime-preference-candidate\)/);
      assert.match(globalRuntime?.body ?? "", /Keep responses short today/);
      assert.equal(globalRuntime?.metadata.source_revision, "rev-local-pref-1");
    } finally {
      runtime.close();
    }
  });

  it("reads durable frames from persistent knowledge.db when no store is injected", () => {
    const runtimeDbPath = join(tempDir, "persistent-read", "runtime.db");
    const runtime = new RuntimeStore({ dbPath: runtimeDbPath });
    const knowledgeDbPath = resolveLocalKnowledgeDbPath(runtimeDbPath);
    const knowledge = new LocalSqliteKnowledgeStore({ dbPath: knowledgeDbPath });
    let resolved: ReturnType<typeof createProjectionRenderSource> | undefined;
    try {
      knowledge.write([
        createFrame({
          id: "persisted-pref",
          kind: "semantic",
          content: "Persisted local knowledge frame.",
          source: { surface: "cursor" },
          created_at: "2026-05-25T00:00:00.000Z",
          scope: { kind: "project", project_ref: LOCAL_PROJECT_REF },
          curation_mode: "personal",
        }),
      ]);
      knowledge.close();

      resolved = createProjectionRenderSource({
        sourceKind: "local",
        projectRef: LOCAL_PROJECT_REF,
        runtimeDbPath,
        deps: { openRuntimeStore: () => runtime },
      });

      assert.ok(resolved && !("error" in resolved));
      if (!resolved || "error" in resolved) return;

      const documents = resolved.source.loadProjectionDocuments({
        projectRef: LOCAL_PROJECT_REF,
      });
      const projectProjection = documents.find((doc) => doc.metadata.kind === "project_projection");
      assert.match(projectProjection?.body ?? "", /Persisted local knowledge frame\./);
    } finally {
      resolvedCleanup(resolved);
      runtime.close();
    }
  });

  it("prefers injected knowledge store over persistent knowledge.db", () => {
    const runtimeDbPath = join(tempDir, "injected-over-persistent", "runtime.db");
    const runtime = new RuntimeStore({ dbPath: runtimeDbPath });
    const injected = new InMemoryKnowledgeStore();
    const persistent = new LocalSqliteKnowledgeStore({
      dbPath: resolveLocalKnowledgeDbPath(runtimeDbPath),
    });
    let resolved: ReturnType<typeof createProjectionRenderSource> | undefined;
    try {
      injected.write([
        createFrame({
          id: "injected-pref",
          kind: "semantic",
          content: "Injected knowledge wins.",
          source: { surface: "cursor" },
          created_at: "2026-05-25T00:00:00.000Z",
          scope: { kind: "project", project_ref: LOCAL_PROJECT_REF },
          curation_mode: "personal",
        }),
      ]);
      persistent.write([
        createFrame({
          id: "persistent-pref",
          kind: "semantic",
          content: "Persistent knowledge should not win.",
          source: { surface: "cursor" },
          created_at: "2026-05-25T00:00:00.000Z",
          scope: { kind: "project", project_ref: LOCAL_PROJECT_REF },
          curation_mode: "personal",
        }),
      ]);
      persistent.close();

      resolved = createProjectionRenderSource({
        sourceKind: "local",
        projectRef: LOCAL_PROJECT_REF,
        runtimeDbPath,
        knowledgeStore: injected,
        deps: { openRuntimeStore: () => runtime },
      });

      assert.ok(resolved && !("error" in resolved));
      if (!resolved || "error" in resolved) return;

      const projectProjection = resolved.source
        .loadProjectionDocuments({ projectRef: LOCAL_PROJECT_REF })
        .find((doc) => doc.metadata.kind === "project_projection");
      assert.match(projectProjection?.body ?? "", /Injected knowledge wins\./);
      assert.doesNotMatch(projectProjection?.body ?? "", /Persistent knowledge should not win\./);
    } finally {
      resolvedCleanup(resolved);
      runtime.close();
    }
  });

  it("closes persistent knowledge store via projection source cleanup", async () => {
    const runtimeDbPath = join(tempDir, "persistent-cleanup", "runtime.db");
    const runtime = new RuntimeStore({ dbPath: runtimeDbPath });
    try {
      const resolved = createProjectionRenderSource({
        sourceKind: "local",
        projectRef: LOCAL_PROJECT_REF,
        runtimeDbPath,
        deps: { openRuntimeStore: () => runtime },
      });

      assert.ok(!("error" in resolved));
      resolved.cleanup();

      const reopened = new LocalSqliteKnowledgeStore({
        dbPath: resolveLocalKnowledgeDbPath(runtimeDbPath),
      });
      try {
        assert.equal(reopened.list().length, 0);
      } finally {
        reopened.close();
      }
    } finally {
      runtime.close();
    }
  });
});

describe("local projection source cleanup ordering", () => {
  let tempDir = "";

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "amp-projection-source-cleanup-order-"));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("still closes persistent knowledge when runtime cleanup throws", () => {
    const runtimeDbPath = join(tempDir, "runtime-throws", "runtime.db");
    const runtime = new RuntimeStore({ dbPath: runtimeDbPath });
    let knowledgeCloseCalls = 0;
    const originalKnowledgeClose = LocalSqliteKnowledgeStore.prototype.close;
    LocalSqliteKnowledgeStore.prototype.close = function closeWithSpy(
      this: LocalSqliteKnowledgeStore,
    ) {
      knowledgeCloseCalls += 1;
      return originalKnowledgeClose.call(this);
    };

    const originalRuntimeClose = runtime.close.bind(runtime);
    runtime.close = () => {
      originalRuntimeClose();
      throw new Error("runtime cleanup failed");
    };

    let resolved: ReturnType<typeof createProjectionRenderSource> | undefined;
    try {
      resolved = createProjectionRenderSource({
        sourceKind: "local",
        projectRef: LOCAL_PROJECT_REF,
        runtimeDbPath,
        deps: { openRuntimeStore: () => runtime },
      });

      assert.ok(resolved && !("error" in resolved));
      if (!resolved || "error" in resolved) return;

      assert.throws(() => resolved.cleanup(), /runtime cleanup failed/);
      assert.equal(knowledgeCloseCalls, 1);
      resolved = undefined;
    } finally {
      LocalSqliteKnowledgeStore.prototype.close = originalKnowledgeClose;
    }
  });

  it("still closes runtime store when knowledge cleanup throws", () => {
    const runtimeDbPath = join(tempDir, "knowledge-throws", "runtime.db");
    const runtime = new RuntimeStore({ dbPath: runtimeDbPath });
    let runtimeCloseCalls = 0;
    const originalRuntimeClose = runtime.close.bind(runtime);
    runtime.close = () => {
      runtimeCloseCalls += 1;
      originalRuntimeClose();
    };

    const originalKnowledgeClose = LocalSqliteKnowledgeStore.prototype.close;
    LocalSqliteKnowledgeStore.prototype.close = function closeWithFailure(
      this: LocalSqliteKnowledgeStore,
    ) {
      originalKnowledgeClose.call(this);
      throw new Error("knowledge cleanup failed");
    };

    let resolved: ReturnType<typeof createProjectionRenderSource> | undefined;
    try {
      resolved = createProjectionRenderSource({
        sourceKind: "local",
        projectRef: LOCAL_PROJECT_REF,
        runtimeDbPath,
        deps: { openRuntimeStore: () => runtime },
      });

      assert.ok(resolved && !("error" in resolved));
      if (!resolved || "error" in resolved) return;

      assert.throws(() => resolved.cleanup(), /knowledge cleanup failed/);
      assert.equal(runtimeCloseCalls, 1);
      resolved = undefined;
    } finally {
      LocalSqliteKnowledgeStore.prototype.close = originalKnowledgeClose;
    }
  });
});

function resolvedCleanup(
  resolved: ReturnType<typeof createProjectionRenderSource> | undefined,
): void {
  if (resolved && !("error" in resolved)) {
    resolved.cleanup();
  }
}

describe("createProjectionRenderSource gbrain", () => {
  let tempDir = "";

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "amp-projection-source-gbrain-"));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns preflight error for invalid knowledge backend env", () => {
    const resolved = createProjectionRenderSource({
      sourceKind: "gbrain",
      runtimeDbPath: join(tempDir, "runtime.db"),
      env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "not-a-backend" },
      ampRepoRoot: REPO_ROOT,
    });

    assert.ok("error" in resolved);
    assert.match(resolved.error, /Invalid knowledge backend/);
  });

  it("creates fake-gbrain source without running strict preflight", () => {
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "fake-gbrain-runtime.db") });
    try {
      const resolved = createProjectionRenderSource({
        sourceKind: "gbrain",
        runtimeDbPath: join(tempDir, "fake-gbrain-runtime.db"),
        env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "fake-gbrain" },
        ampRepoRoot: REPO_ROOT,
        deps: { openRuntimeStore: () => runtime },
      });

      assert.ok(!("error" in resolved));
      assert.equal(resolved.source.sourceKind, "gbrain");
    } finally {
      runtime.close();
    }
  });

  it("does not wire runtimeSemanticSource into GbrainProjectionSource", async () => {
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "gbrain-no-typed-runtime.db") });
    const runtimeSemanticSource = preferenceSource();
    const resolved = createProjectionRenderSource({
      sourceKind: "gbrain",
      runtimeDbPath: join(tempDir, "gbrain-no-typed-runtime.db"),
      env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "fake-gbrain" },
      ampRepoRoot: REPO_ROOT,
      runtimeSemanticSource,
      deps: { openRuntimeStore: () => runtime },
    });

    try {
      assert.ok(!("error" in resolved));
      assert.ok(resolved.source instanceof GbrainProjectionSource);
      assert.equal(
        "runtimeSemanticSource" in
          (resolved.source as unknown as { options: GbrainProjectionSourceOptions }).options,
        false,
      );

      const documents = await resolved.source.loadProjectionDocuments();
      const globalRuntime = documents.find((doc) => doc.metadata.kind === "global_runtime");
      assert.doesNotMatch(globalRuntime?.body ?? "", /Typed runtime semantics/);
    } finally {
      resolved.cleanup();
    }
  });

  it("wraps fake-gbrain factory adapter with readonly transport", async () => {
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "readonly-fake-gbrain-runtime.db") });
    try {
      const resolved = createProjectionRenderSource({
        sourceKind: "gbrain",
        runtimeDbPath: join(tempDir, "readonly-fake-gbrain-runtime.db"),
        env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "fake-gbrain" },
        ampRepoRoot: REPO_ROOT,
        deps: { openRuntimeStore: () => runtime },
      });

      assert.ok(!("error" in resolved));
      assert.ok(resolved.source instanceof GbrainProjectionSource);

      const adapter = gbrainAdapterFromSource(resolved.source);
      assert.ok(adapter.transport instanceof ReadonlyGbrainMcpTransport);

      await assert.rejects(
        () =>
          adapter.transport.callTool("put_page", {
            slug: "amp/frames/h.readonly-factory-probe",
            content: "Must not reach gbrain.",
          }),
        /Readonly gbrain transport rejected mutating tool put_page/
      );
    } finally {
      runtime.close();
    }
  });
});
