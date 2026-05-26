import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FIXTURE_ISO, FIXTURE_PROJECT_REF } from "./runtime-semantics.test-fixture.js";
import {
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
});
