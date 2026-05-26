import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FIXTURE_ISO, FIXTURE_PROJECT_REF } from "./runtime-semantics.test-fixture.js";
import {
  defaultRejectedSignalRecordId,
  mapRejectedRuntimeCaptureToEntityRecord,
} from "./capture-rejected-signal-mapper.js";

describe("mapRejectedRuntimeCaptureToEntityRecord", () => {
  it("maps rejected audit metadata to a rejected-signal-log entity without raw content", () => {
    const result = mapRejectedRuntimeCaptureToEntityRecord({
      recordId: "rej-audit-1",
      rejectedSignalId: "capture-reject:abc",
      timestamp: FIXTURE_ISO,
      reasonCode: "credentials_or_secrets",
      sourceSurface: "cursor",
      scope: "user",
      sourceHash: "sha256:deadbeef",
      redactedExcerpt: "token=[REDACTED]",
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.equal(result.record.kind, "rejected-signal-log");
    assert.equal(result.record.id, "rej-audit-1");
    assert.deepEqual(result.record.payload, {
      rejected_signal_id: "capture-reject:abc",
      timestamp: FIXTURE_ISO,
      reason_code: "credentials_or_secrets",
      source_surface: "cursor",
      scope: "user",
      source_hash: "sha256:deadbeef",
      redacted_excerpt: "token=[REDACTED]",
    });
    assert.equal("raw_content" in (result.record.payload as object), false);
  });

  it("includes project_ref for project-scoped audit rows", () => {
    const result = mapRejectedRuntimeCaptureToEntityRecord({
      recordId: defaultRejectedSignalRecordId("capture-reject:proj"),
      rejectedSignalId: "capture-reject:proj",
      timestamp: FIXTURE_ISO,
      reasonCode: "telemetry_without_semantic_content",
      sourceSurface: "test",
      scope: "project",
      projectRef: FIXTURE_PROJECT_REF,
      sourceHash: "sha256:abc123",
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.record.project_ref, FIXTURE_PROJECT_REF);
      assert.equal(result.record.payload.scope, "project");
    }
  });

  it("fails closed when project scope is missing project_ref", () => {
    const result = mapRejectedRuntimeCaptureToEntityRecord({
      recordId: "rej-project-missing-ref",
      rejectedSignalId: "capture-reject:proj",
      timestamp: FIXTURE_ISO,
      reasonCode: "telemetry_without_semantic_content",
      sourceSurface: "test",
      scope: "project",
      sourceHash: "sha256:abc123",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "missing_project_ref");
    }
  });
});
