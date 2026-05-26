import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { FIXTURE_ISO, FIXTURE_PROJECT_REF } from "./runtime-semantics.test-fixture.js";
import { captureRuntimeCorrection } from "./capture-correction.js";
import { RuntimeStoreSemanticEntityReader } from "./storage-source.js";

describe("captureRuntimeCorrection", () => {
  it("persists a valid correction through the typed runtime semantic writer", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-correction-capture-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    try {
      const result = captureRuntimeCorrection(runtime, {
        targetEntityId: "frame-123",
        recordId: "correction-frame-123",
        note: "Reclassify as correction_event",
        scope: "user",
        occurredAt: FIXTURE_ISO,
        recordedAt: FIXTURE_ISO,
      });

      assert.deepEqual(result, { ok: true, recordId: "correction-frame-123" });
      assert.equal(runtime.queueList().length, 0);
      assert.deepEqual(
        new RuntimeStoreSemanticEntityReader(runtime).readEntities().map((row) => row.id),
        ["correction-frame-123"],
      );
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails closed before storage when project_ref is missing", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-correction-invalid-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    try {
      const result = captureRuntimeCorrection(runtime, {
        targetEntityId: "frame-123",
        recordId: "correction-frame-123",
        note: "Project correction",
        scope: "project",
        occurredAt: FIXTURE_ISO,
        recordedAt: FIXTURE_ISO,
      });

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "missing_project_ref");
      }
      assert.deepEqual(runtime.semanticEntityList(), []);
      assert.equal(runtime.queueList().length, 0);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns duplicate_id when the correction record id already exists", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-correction-duplicate-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    try {
      const input = {
        targetEntityId: "frame-123",
        recordId: "correction-frame-123",
        note: "First correction",
        scope: "project" as const,
        projectRef: FIXTURE_PROJECT_REF,
        occurredAt: FIXTURE_ISO,
        recordedAt: FIXTURE_ISO,
      };

      assert.equal(captureRuntimeCorrection(runtime, input).ok, true);
      const duplicate = captureRuntimeCorrection(runtime, {
        ...input,
        note: "Duplicate correction",
      });

      assert.equal(duplicate.ok, false);
      if (!duplicate.ok) {
        assert.equal(duplicate.reason, "duplicate_id");
      }
      assert.equal(runtime.semanticEntityList().length, 1);
      assert.equal(runtime.queueList().length, 0);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
