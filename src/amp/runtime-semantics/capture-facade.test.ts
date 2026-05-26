import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { EPISODIC_CORRECTION_ACTIVE_PROJECTION_HEADING } from "./messages.js";
import { materializeRuntimeProjectionFromSource } from "./projection-source.js";
import {
  RuntimeSemanticStorageEntitySource,
  RuntimeStoreSemanticEntityReader,
} from "./storage-source.js";
import { createRuntimeSemanticCaptureFacade } from "./capture-facade.js";
import type { RuntimeSemanticEntityRecord } from "./entity-record.js";
import {
  ACTIVE_PREFERENCE,
  FIXTURE_ISO,
  FIXTURE_PROJECT_REF,
} from "./runtime-semantics.test-fixture.js";

describe("createRuntimeSemanticCaptureFacade", () => {
  it("persists explicit correction for inspect and runtime projection", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-capture-facade-correction-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    const note = "Facade explicit correction note";

    try {
      const facade = createRuntimeSemanticCaptureFacade(runtime);
      const capture = facade.captureExplicitCorrection({
        targetEntityId: "frame-facade",
        recordId: "correction-frame-facade",
        note,
        scope: "user",
        occurredAt: FIXTURE_ISO,
        recordedAt: FIXTURE_ISO,
      });

      assert.deepEqual(capture, { ok: true, recordId: "correction-frame-facade" });
      assert.equal(runtime.queueList().length, 0);

      const inspectIds = new RuntimeStoreSemanticEntityReader(runtime)
        .readEntities()
        .map((row) => row.id);
      assert.deepEqual(inspectIds, ["correction-frame-facade"]);

      const projectionReader = new RuntimeSemanticStorageEntitySource(
        new RuntimeStoreSemanticEntityReader(runtime),
      );
      const materialized = materializeRuntimeProjectionFromSource(projectionReader, {
        projectRef: FIXTURE_PROJECT_REF,
      });
      assert.equal(materialized.items.length, 1);
      assert.match(materialized.items[0]?.text ?? "", new RegExp(note));
      assert.match(
        materialized.items[0]?.text ?? "",
        new RegExp(EPISODIC_CORRECTION_ACTIVE_PROJECTION_HEADING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails closed on invalid explicit correction before storage", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-capture-facade-invalid-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      const facade = createRuntimeSemanticCaptureFacade(runtime);
      const result = facade.captureExplicitCorrection({
        targetEntityId: "frame-facade",
        recordId: "correction-frame-facade",
        note: "   ",
        scope: "user",
        occurredAt: FIXTURE_ISO,
        recordedAt: FIXTURE_ISO,
      });

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "invalid_note");
      }
      assert.deepEqual(runtime.semanticEntityList(), []);
      assert.equal(runtime.queueList().length, 0);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("writes valid typed entities and rejects invalid records", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-capture-facade-write-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      const facade = createRuntimeSemanticCaptureFacade(runtime);
      const valid = facade.writeValidatedEntity({
        id: "pref-facade",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: { ...ACTIVE_PREFERENCE, id: "pref-facade" },
      });
      assert.deepEqual(valid, { ok: true, recordId: "pref-facade" });

      const invalid = facade.writeValidatedEntity({
        id: "bad-kind",
        kind: "not-a-runtime-kind" as RuntimeSemanticEntityRecord["kind"],
        scope: "user",
        payload: {},
      });
      assert.equal(invalid.ok, false);
      if (!invalid.ok) {
        assert.equal(invalid.reason, "unknown_kind");
      }

      assert.deepEqual(
        runtime.semanticEntityList().map((row) => row.id),
        ["pref-facade"],
      );
      assert.equal(runtime.queueList().length, 0);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
