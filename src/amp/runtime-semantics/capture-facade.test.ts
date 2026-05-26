import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { RuntimeStoreSemanticEntityReader } from "./storage-source.js";
import { createRuntimeSemanticCaptureFacade } from "./capture-facade.js";
import { EXPLICIT_CORRECTION_TEST_PROVENANCE } from "./capture-correction-mapper.js";
import type { RuntimeSemanticEntityRecord } from "./entity-record.js";
import {
  ACTIVE_PREFERENCE,
  FIXTURE_ISO,
  TRACEABLE_EPISODIC_FRAME,
} from "./runtime-semantics.test-fixture.js";

describe("createRuntimeSemanticCaptureFacade", () => {
  it("persists explicit correction for typed storage inspect", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-capture-facade-correction-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      const facade = createRuntimeSemanticCaptureFacade(runtime);
      const capture = facade.captureExplicitCorrection({
        targetEntityId: "frame-facade",
        recordId: "correction-frame-facade",
        note: "Facade explicit correction note",
        scope: "user",
        occurredAt: FIXTURE_ISO,
        recordedAt: FIXTURE_ISO,
        provenance: EXPLICIT_CORRECTION_TEST_PROVENANCE,
      });

      assert.deepEqual(capture, { ok: true, recordId: "correction-frame-facade" });
      assert.equal(runtime.queueList().length, 0);

      const inspectIds = new RuntimeStoreSemanticEntityReader(runtime)
        .readEntities()
        .map((row) => row.id);
      assert.deepEqual(inspectIds, ["correction-frame-facade"]);
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
        provenance: EXPLICIT_CORRECTION_TEST_PROVENANCE,
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

  it("rejects generic episodic-frame writes without transform provenance", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-capture-facade-provenance-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      const facade = createRuntimeSemanticCaptureFacade(runtime);
      const result = facade.writeValidatedEntity({
        id: "episodic-missing-provenance",
        kind: "episodic-frame",
        scope: "user",
        payload: {
          ...TRACEABLE_EPISODIC_FRAME,
          id: "episodic-missing-provenance",
          provenance: {},
        },
      });

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "missing_provenance_transform_id");
      }
      assert.deepEqual(runtime.semanticEntityList(), []);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts generic episodic-frame writes with transform provenance", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-capture-facade-provenance-ok-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      const facade = createRuntimeSemanticCaptureFacade(runtime);
      const result = facade.writeValidatedEntity({
        id: "episodic-valid-provenance",
        kind: "episodic-frame",
        scope: "user",
        payload: {
          ...TRACEABLE_EPISODIC_FRAME,
          id: "episodic-valid-provenance",
        },
      });

      assert.deepEqual(result, { ok: true, recordId: "episodic-valid-provenance" });
      assert.deepEqual(
        runtime.semanticEntityList().map((row) => row.id),
        ["episodic-valid-provenance"],
      );
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("persists rejected-signal audit rows through the facade writer path", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-capture-facade-rejected-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      const facade = createRuntimeSemanticCaptureFacade(runtime);
      const filtered = facade.filterAndCaptureRejectedSignal({
        content: "Bearer super-secret-token-value-should-not-persist",
        sourceSurface: "test",
        scope: "user",
        timestamp: FIXTURE_ISO,
        recordId: "rej-facade-1",
        rejectedSignalId: "capture-reject:facade",
      });

      assert.deepEqual(filtered, {
        status: "rejected_audited",
        recordId: "rej-facade-1",
        reason_code: "credentials_or_secrets",
      });
      assert.equal(runtime.queueList().length, 0);

      const stored = runtime.semanticEntityList()[0];
      assert.equal(stored?.kind, "rejected-signal-log");
      assert.doesNotMatch(JSON.stringify(stored?.payload), /super-secret-token-value-should-not-persist/);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns rejected_audit_failed through the facade when audit persistence fails", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-capture-facade-audit-failed-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      const facade = createRuntimeSemanticCaptureFacade(runtime);
      const result = facade.filterAndCaptureRejectedSignal({
        content: "Bearer facade-audit-failure-token",
        sourceSurface: "test",
        scope: "project",
        timestamp: FIXTURE_ISO,
      });

      assert.equal(result.status, "rejected_audit_failed");
      if (result.status === "rejected_audit_failed") {
        assert.equal(result.reason, "missing_project_ref");
      }
      assert.deepEqual(runtime.semanticEntityList(), []);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("writes pre-mapped rejected audit rows via captureRejectedSignalAudit", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-capture-facade-rejected-direct-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      const facade = createRuntimeSemanticCaptureFacade(runtime);
      const result = facade.captureRejectedSignalAudit({
        recordId: "rej-facade-direct",
        rejectedSignalId: "capture-reject:direct",
        timestamp: FIXTURE_ISO,
        reasonCode: "telemetry_without_semantic_content",
        sourceSurface: "test",
        scope: "user",
        sourceHash: "sha256:feedface",
        redactedExcerpt: "metrics-only",
      });

      assert.deepEqual(result, { ok: true, recordId: "rej-facade-direct" });
      assert.deepEqual(runtime.semanticEntityList().map((row) => row.id), ["rej-facade-direct"]);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

});
