import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { createProjectionRenderSource } from "../cli/projection-source.js";
import { AMP_KNOWLEDGE_BACKEND_ENV } from "../cli/knowledge-backend.js";
import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { captureRuntimeCorrection } from "./capture-correction.js";
import {
  defaultExplicitCorrectionRecordId,
} from "./capture-correction-mapper.js";
import {
  EPISODIC_CORRECTION_ACTIVE_PROJECTION_HEADING,
} from "./messages.js";
import {
  materializeRuntimeProjectionFromSource,
} from "./projection-source.js";
import { RuntimeSemanticStorageEntitySource, RuntimeStoreSemanticEntityReader } from "./storage-source.js";
import { FIXTURE_ISO, FIXTURE_PROJECT_REF } from "./runtime-semantics.test-fixture.js";

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

describe("captureRuntimeCorrection projection coverage", () => {
  it("materializes user-scoped corrections into global runtime projection", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-correction-projection-user-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    const knowledge = new InMemoryKnowledgeStore();
    const note = "Reclassify target as episodic correction";

    try {
      const capture = captureRuntimeCorrection(runtime, {
        targetEntityId: "frame-user",
        recordId: "correction-frame-user",
        note,
        scope: "user",
        occurredAt: FIXTURE_ISO,
        recordedAt: FIXTURE_ISO,
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
      const projectRuntime = documents.find((doc) => doc.metadata.kind === "project_runtime");

      assert.match(globalRuntime?.body ?? "", new RegExp(note));
      assert.match(globalRuntime?.body ?? "", new RegExp(EPISODIC_CORRECTION_ACTIVE_PROJECTION_HEADING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(projectRuntime?.body ?? "", new RegExp(note));
    } finally {
      await resolvedCleanup(runtime, tempDir);
    }
  });

  it("materializes project-scoped corrections into project runtime projection", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-correction-projection-project-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    const knowledge = new InMemoryKnowledgeStore();
    const note = "Project-scoped operator correction";

    try {
      const capture = captureRuntimeCorrection(runtime, {
        targetEntityId: "frame-project",
        recordId: "correction-frame-project",
        note,
        scope: "project",
        projectRef: FIXTURE_PROJECT_REF,
        occurredAt: FIXTURE_ISO,
        recordedAt: FIXTURE_ISO,
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
      const projectRuntime = documents.find((doc) => doc.metadata.kind === "project_runtime");

      assert.match(projectRuntime?.body ?? "", new RegExp(note));
      assert.match(projectRuntime?.body ?? "", new RegExp(EPISODIC_CORRECTION_ACTIVE_PROJECTION_HEADING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(globalRuntime?.body ?? "", new RegExp(note));
    } finally {
      await resolvedCleanup(runtime, tempDir);
    }
  });

  it("renders correction frames as episodic context, not durable semantic truth", () => {
    const runtime = new RuntimeStore({ dbPath: ":memory:" });
    try {
      captureRuntimeCorrection(runtime, {
        targetEntityId: "frame-123",
        recordId: "correction-frame-123",
        note: "Operator correction note",
        scope: "user",
        occurredAt: FIXTURE_ISO,
        recordedAt: FIXTURE_ISO,
      });

      const reader = new RuntimeSemanticStorageEntitySource(
        new RuntimeStoreSemanticEntityReader(runtime),
      );
      const result = materializeRuntimeProjectionFromSource(reader, {
        projectRef: FIXTURE_PROJECT_REF,
      });

      assert.equal(result.items.length, 1);
      const item = result.items[0];
      assert.equal(item?.kind, "episodic-frame");
      assert.equal(item?.section, "globalRuntime");
      assert.match(item?.text ?? "", new RegExp(EPISODIC_CORRECTION_ACTIVE_PROJECTION_HEADING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(item?.text ?? "", /Operator correction note/);
      assert.doesNotMatch(item?.text ?? "", /Working hypothesis/i);
      assert.doesNotMatch(item?.text ?? "", /Pending decision/i);
      assert.equal(item?.formatted.activeInstruction, false);
    } finally {
      runtime.close();
    }
  });

  it("keeps duplicate default record ids fail-closed with a single projection block", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-correction-projection-duplicate-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    const knowledge = new InMemoryKnowledgeStore();
    const targetEntityId = "frame-dup-default";
    const recordId = defaultExplicitCorrectionRecordId(targetEntityId);
    const firstNote = "First explicit correction";

    try {
      const first = captureRuntimeCorrection(runtime, {
        targetEntityId,
        recordId,
        note: firstNote,
        scope: "user",
        occurredAt: FIXTURE_ISO,
        recordedAt: FIXTURE_ISO,
      });
      assert.equal(first.ok, true);

      const duplicate = captureRuntimeCorrection(runtime, {
        targetEntityId,
        recordId,
        note: "Second explicit correction",
        scope: "user",
        occurredAt: FIXTURE_ISO,
        recordedAt: FIXTURE_ISO,
      });
      assert.equal(duplicate.ok, false);
      if (!duplicate.ok) {
        assert.equal(duplicate.reason, "duplicate_id");
      }

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
      const body = globalRuntime?.body ?? "";

      assert.equal(countOccurrences(body, firstNote), 1);
      assert.equal(countOccurrences(body, "Second explicit correction"), 0);
      assert.equal(countOccurrences(body, recordId), 0);
      assert.equal(runtime.semanticEntityList().length, 1);
    } finally {
      await resolvedCleanup(runtime, tempDir);
    }
  });
});

async function resolvedCleanup(runtime: RuntimeStore, tempDir: string): Promise<void> {
  runtime.close();
  await rm(tempDir, { recursive: true, force: true });
}
