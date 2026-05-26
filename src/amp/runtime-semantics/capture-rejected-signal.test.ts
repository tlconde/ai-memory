import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import {
  InMemoryRuntimeSemanticEntitySource,
  materializeRuntimeProjectionFromSource,
} from "./projection-source.js";
import { RuntimeStoreSemanticEntityReader } from "./storage-source.js";
import {
  captureRejectedRuntimeSignal,
  filterAndCaptureRejectedRuntimeSignal,
  isFilteredRuntimeCaptureAccepted,
} from "./capture-rejected-signal.js";
import { FIXTURE_ISO, FIXTURE_PROJECT_REF } from "./runtime-semantics.test-fixture.js";

describe("captureRejectedRuntimeSignal", () => {
  it("persists audit-only rejected-signal-log rows", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-rejected-capture-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      const result = captureRejectedRuntimeSignal(runtime, {
        recordId: "rej-writer-1",
        rejectedSignalId: "capture-reject:writer",
        timestamp: FIXTURE_ISO,
        reasonCode: "telemetry_without_semantic_content",
        sourceSurface: "test",
        scope: "project",
        projectRef: FIXTURE_PROJECT_REF,
        sourceHash: "sha256:abc123",
        redactedExcerpt: "metric-only payload",
      });

      assert.deepEqual(result, { ok: true, recordId: "rej-writer-1" });
      assert.equal(runtime.queueList().length, 0);

      const stored = runtime.semanticEntityList()[0];
      assert.equal(stored?.kind, "rejected-signal-log");
      assert.equal(JSON.stringify(stored?.payload), JSON.stringify({
        rejected_signal_id: "capture-reject:writer",
        timestamp: FIXTURE_ISO,
        reason_code: "telemetry_without_semantic_content",
        source_surface: "test",
        scope: "project",
        source_hash: "sha256:abc123",
        redacted_excerpt: "metric-only payload",
      }));
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("filterAndCaptureRejectedRuntimeSignal", () => {
  it("returns accepted signals without persisting audit rows", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-filter-accept-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      const result = filterAndCaptureRejectedRuntimeSignal(runtime, {
        content: "Use typed runtime storage for semantic entities.",
        sourceSurface: "test",
        scope: "user",
        timestamp: FIXTURE_ISO,
      });

      assert.equal(result.status, "accepted");
      assert.ok(isFilteredRuntimeCaptureAccepted(result));
      assert.match(result.accepted.source_hash, /^sha256:/);
      assert.deepEqual(runtime.semanticEntityList(), []);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("auto-generates stable rejected audit ids when omitted", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-filter-autogen-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      const result = filterAndCaptureRejectedRuntimeSignal(runtime, {
        content: "Bearer autogen-secret-token",
        sourceSurface: "test",
        scope: "user",
        timestamp: FIXTURE_ISO,
      });

      assert.equal(result.status, "rejected_audited");
      if (result.status === "rejected_audited") {
        assert.match(result.recordId, /^rejected-signal:capture-reject:/);
        assert.equal(result.reason_code, "credentials_or_secrets");
      }
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("persists rejected-signal audit rows for excluded secrets without raw content", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-filter-reject-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    const secret = "ghp_123456789012345678901234567890123456";

    try {
      const result = filterAndCaptureRejectedRuntimeSignal(runtime, {
        content: `Never capture ${secret} in runtime memory.`,
        sourceSurface: "cursor",
        scope: "project",
        projectRef: FIXTURE_PROJECT_REF,
        timestamp: FIXTURE_ISO,
        recordId: "rej-filter-secret",
        rejectedSignalId: "capture-reject:secret",
      });

      assert.deepEqual(result, {
        status: "rejected_audited",
        recordId: "rej-filter-secret",
        reason_code: "credentials_or_secrets",
      });
      assert.equal(runtime.queueList().length, 0);

      const reader = new RuntimeStoreSemanticEntityReader(runtime);
      const stored = reader.readEntities()[0];
      assert.equal(stored?.kind, "rejected-signal-log");
      assert.equal(stored?.payload.reason_code, "credentials_or_secrets");
      assert.doesNotMatch(JSON.stringify(stored?.payload), new RegExp(secret));

      const source = new InMemoryRuntimeSemanticEntitySource(reader.readEntities());
      const materialized = materializeRuntimeProjectionFromSource(source, {
        projectRef: FIXTURE_PROJECT_REF,
      });
      assert.equal(materialized.items.length, 0);
      assert.equal(materialized.skipped.length, 1);
      assert.equal(materialized.skipped[0]?.reason, "not_projectable");
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns rejected_audit_failed when audit persistence fails", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-filter-audit-failed-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      const result = filterAndCaptureRejectedRuntimeSignal(runtime, {
        content: "Bearer secret-token-for-failed-audit",
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
});
