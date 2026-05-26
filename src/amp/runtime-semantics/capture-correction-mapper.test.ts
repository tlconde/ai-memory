import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FIXTURE_ISO, FIXTURE_PROJECT_REF } from "./runtime-semantics.test-fixture.js";
import {
  EXPLICIT_CORRECTION_CLI_PROVENANCE,
  EXPLICIT_CORRECTION_TEST_PROVENANCE,
  explicitCorrectionTransformId,
  mapExplicitRuntimeCorrectionToEntityRecord,
  type ExplicitRuntimeCorrectionCaptureInput,
} from "./capture-correction-mapper.js";

const BASE_INPUT: ExplicitRuntimeCorrectionCaptureInput = {
  targetEntityId: "frame-123",
  recordId: "correction-frame-123",
  note: "Reclassify as correction_event",
  scope: "user",
  occurredAt: FIXTURE_ISO,
  recordedAt: FIXTURE_ISO,
  provenance: EXPLICIT_CORRECTION_TEST_PROVENANCE,
};

describe("mapExplicitRuntimeCorrectionToEntityRecord", () => {
  it("maps explicit correction input to a valid episodic-frame runtime entity", () => {
    const result = mapExplicitRuntimeCorrectionToEntityRecord(BASE_INPUT);

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.equal(result.record.id, "correction-frame-123");
    assert.equal(result.record.kind, "episodic-frame");
    assert.equal(result.record.scope, "user");
    assert.equal(result.record.payload.id, "correction-frame-123");
    assert.equal(result.record.payload.event_type, "correction");
    assert.equal(result.record.payload.summary, BASE_INPUT.note);
    assert.equal(result.record.payload.source, "user_explicit");
    assert.deepEqual(result.record.payload.details, {
      target_entity_id: "frame-123",
      correction_of: "frame-123",
      capture_path: "explicit_operator_correction",
      source_surface: "test",
      source_command: "runtime-semantics.test",
    });
    assert.deepEqual(result.record.payload.provenance, {
      transform_id: explicitCorrectionTransformId("test"),
    });
  });

  it("includes project_ref for project-scoped corrections", () => {
    const result = mapExplicitRuntimeCorrectionToEntityRecord({
      ...BASE_INPUT,
      scope: "project",
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.record.project_ref, FIXTURE_PROJECT_REF);
      assert.equal(result.record.payload.project_ref, FIXTURE_PROJECT_REF);
      assert.equal(result.record.payload.visibility, "project_only");
    }
  });

  it("fails closed when project scope is missing project_ref", () => {
    const result = mapExplicitRuntimeCorrectionToEntityRecord({
      ...BASE_INPUT,
      scope: "project",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "missing_project_ref");
    }
  });

  it("fails closed when note is empty", () => {
    const result = mapExplicitRuntimeCorrectionToEntityRecord({
      ...BASE_INPUT,
      note: "   ",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "invalid_note");
    }
  });

  it("maps optional provenance into details, provenance.transform_id, and source_signals", () => {
    const result = mapExplicitRuntimeCorrectionToEntityRecord({
      ...BASE_INPUT,
      sourceSignalIds: ["signal-correction-1"],
      provenance: {
        sourceSurface: "test",
        sourceCommand: "capture-correction-mapper.test",
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.deepEqual(result.record.payload.source_signals, ["signal-correction-1"]);
    assert.deepEqual(result.record.payload.provenance, {
      transform_id: explicitCorrectionTransformId("test"),
    });
    assert.deepEqual(result.record.payload.details, {
      target_entity_id: "frame-123",
      correction_of: "frame-123",
      capture_path: "explicit_operator_correction",
      source_surface: "test",
      source_command: "capture-correction-mapper.test",
    });
  });

  it("uses the stable CLI provenance marker shape", () => {
    const result = mapExplicitRuntimeCorrectionToEntityRecord({
      ...BASE_INPUT,
      provenance: EXPLICIT_CORRECTION_CLI_PROVENANCE,
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.equal(
      result.record.payload.provenance.transform_id,
      explicitCorrectionTransformId("cli"),
    );
    assert.equal(result.record.payload.details?.source_surface, "cli");
    assert.equal(result.record.payload.details?.source_command, "amp runtime correct");
  });
});
