import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { createProjectionRenderSource } from "../cli/projection-source.js";
import { AMP_KNOWLEDGE_BACKEND_ENV } from "../cli/knowledge-backend.js";
import { capturePreference } from "../substrate/capture-preference.js";
import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { createRuntimeSemanticCaptureFacade } from "./capture-facade.js";
import { captureRuntimePreferenceCandidate } from "./capture-preference-candidate.js";
import { FIXTURE_ISO, FIXTURE_PROJECT_REF, ACTIVE_PREFERENCE } from "./runtime-semantics.test-fixture.js";

describe("createRuntimeSemanticCaptureFacade captureRuntimePreferenceCandidate", () => {
  it("persists valid preference candidates into runtime_semantic_entity", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-pref-candidate-facade-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      const facade = createRuntimeSemanticCaptureFacade(runtime);
      const capture = facade.captureRuntimePreferenceCandidate({
        statement: "Prefer concise commit messages",
        mode: "tentative",
        scope: "user",
        observedAt: FIXTURE_ISO,
        sourceSignalIds: ["signal-pref-facade"],
        recordId: "pref-facade-1",
      });

      assert.deepEqual(capture, { ok: true, recordId: "pref-facade-1" });
      assert.equal(runtime.queueList().length, 0);
      assert.equal(runtime.semanticEntityList().length, 1);
      assert.equal(runtime.semanticEntityList()[0]?.kind, "runtime-preference-candidate");
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails through the provenance gate when source signal ids are blank", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-pref-candidate-provenance-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      const facade = createRuntimeSemanticCaptureFacade(runtime);
      const result = facade.captureRuntimePreferenceCandidate({
        statement: "Prefer concise commit messages",
        mode: "tentative",
        scope: "user",
        observedAt: FIXTURE_ISO,
        sourceSignalIds: ["   "],
        recordId: "pref-missing-provenance",
      });

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "missing_source_signal_id");
      }
      assert.deepEqual(runtime.semanticEntityList(), []);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("facade provenance gate rejects blank payload source_signal_ids", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-pref-candidate-provenance-gate-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      const facade = createRuntimeSemanticCaptureFacade(runtime);
      const result = facade.writeValidatedEntity({
        id: "pref-provenance-gate",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: {
          ...ACTIVE_PREFERENCE,
          id: "pref-provenance-gate",
          source_signal_ids: ["   "],
        },
      });

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "missing_source_signal_ids");
      }
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("captureRuntimePreferenceCandidate", () => {
  it("persists through the validated writer without using the queue", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-pref-candidate-direct-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      const result = captureRuntimePreferenceCandidate(runtime, {
        statement: "Direct orchestrator preference capture",
        mode: "tentative",
        scope: "user",
        observedAt: FIXTURE_ISO,
        sourceSignalIds: ["signal-direct"],
        recordId: "pref-direct-1",
      });

      assert.deepEqual(result, { ok: true, recordId: "pref-direct-1" });
      assert.equal(runtime.queueList().length, 0);
      assert.equal(runtime.semanticEntityList().length, 1);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("captureRuntimePreferenceCandidate projection coverage", () => {
  it("materializes persisted preference candidates into default local projection", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-pref-candidate-projection-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    const knowledge = new InMemoryKnowledgeStore();
    const statement = "Keep typed preference candidates in runtime projection";

    try {
      const facade = createRuntimeSemanticCaptureFacade(runtime);
      const capture = facade.captureRuntimePreferenceCandidate({
        statement,
        mode: "time_bounded",
        scope: "user",
        expiresAt: FIXTURE_ISO,
        observedAt: FIXTURE_ISO,
        sourceSignalIds: ["signal-pref-projection"],
        recordId: "pref-projection-1",
      });
      assert.equal(capture.ok, true);

      const resolved = createProjectionRenderSource({
        sourceKind: "local",
        projectRef: FIXTURE_PROJECT_REF,
        runtimeDbPath: join(tempDir, "runtime.db"),
        knowledgeStore: knowledge,
        env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "in-memory" },
        deps: { openRuntimeStore: () => runtime },
      });
      assert.ok(!("error" in resolved));

      const documents = resolved.source.loadProjectionDocuments({
        projectRef: FIXTURE_PROJECT_REF,
      });
      const globalRuntime = documents.find((doc) => doc.metadata.kind === "global_runtime");

      assert.match(globalRuntime?.body ?? "", new RegExp(statement));
      assert.match(globalRuntime?.body ?? "", /expires_at:/i);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("captureRuntimePreferenceCandidate queue isolation", () => {
  it("does not replace existing amp capture queue behavior", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-pref-candidate-queue-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      const facade = createRuntimeSemanticCaptureFacade(runtime);
      const typed = facade.captureRuntimePreferenceCandidate({
        statement: "Typed preference candidate path",
        mode: "tentative",
        scope: "project",
        projectRef: FIXTURE_PROJECT_REF,
        observedAt: FIXTURE_ISO,
        sourceSignalIds: ["signal-typed"],
        recordId: "pref-queue-isolation",
      });
      assert.equal(typed.ok, true);

      const queued = capturePreference(runtime, {
        content: "Queue preference still works.",
        scope: "project",
        projectRef: FIXTURE_PROJECT_REF,
      });

      assert.equal(queued.queued, true);
      assert.equal(runtime.queueList().length, 1);
      assert.equal(runtime.queuePeek()?.payload.content, "Queue preference still works.");
      assert.equal(runtime.semanticEntityList().length, 1);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
