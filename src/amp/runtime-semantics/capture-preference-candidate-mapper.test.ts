import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FIXTURE_ISO, FIXTURE_PROJECT_REF } from "./runtime-semantics.test-fixture.js";
import {
  defaultRuntimePreferenceCandidateRecordId,
  mapCaptureRuntimePreferenceCandidateToEntityRecord,
  type CaptureRuntimePreferenceCandidateInput,
} from "./capture-preference-candidate-mapper.js";

const BASE_TIME_BOUNDED: CaptureRuntimePreferenceCandidateInput = {
  statement: "Keep responses short today",
  mode: "time_bounded",
  scope: "user",
  expiresAt: FIXTURE_ISO,
  observedAt: FIXTURE_ISO,
  sourceSignalIds: ["signal-pref-1"],
};

describe("mapCaptureRuntimePreferenceCandidateToEntityRecord", () => {
  it("maps valid time_bounded preference candidates", () => {
    const result = mapCaptureRuntimePreferenceCandidateToEntityRecord({
      ...BASE_TIME_BOUNDED,
      recordId: "pref-time-bounded",
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.equal(result.record.kind, "runtime-preference-candidate");
    assert.equal(result.record.id, "pref-time-bounded");
    assert.equal(result.record.payload.statement, "Keep responses short today");
    assert.equal(result.record.payload.mode, "time_bounded");
    assert.equal(result.record.payload.expires_at, FIXTURE_ISO);
    assert.deepEqual(result.record.payload.source_signal_ids, ["signal-pref-1"]);
    assert.equal(result.record.payload.status, "active");
  });

  it("maps valid tentative preference candidates without expires_at", () => {
    const result = mapCaptureRuntimePreferenceCandidateToEntityRecord({
      ...BASE_TIME_BOUNDED,
      recordId: "pref-tentative",
      mode: "tentative",
      expiresAt: undefined,
      statement: "Prefer bullet lists for now",
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.equal(result.record.payload.mode, "tentative");
    assert.equal(result.record.payload.expires_at, undefined);
    assert.equal(result.record.payload.statement, "Prefer bullet lists for now");
  });

  it("derives deterministic default record ids from input", () => {
    const recordId = defaultRuntimePreferenceCandidateRecordId({
      statement: "Prefer bullet lists for now",
      scope: "user",
      mode: "tentative",
    });

    const result = mapCaptureRuntimePreferenceCandidateToEntityRecord({
      ...BASE_TIME_BOUNDED,
      mode: "tentative",
      expiresAt: undefined,
      statement: "Prefer bullet lists for now",
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.record.id, recordId);
      assert.match(recordId, /^runtime-preference-candidate:[a-f0-9]{16}$/);
    }
  });

  it("includes project_ref for project-scoped preference candidates", () => {
    const result = mapCaptureRuntimePreferenceCandidateToEntityRecord({
      ...BASE_TIME_BOUNDED,
      recordId: "pref-project",
      scope: "project",
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.record.project_ref, FIXTURE_PROJECT_REF);
      assert.equal(result.record.payload.project_ref, FIXTURE_PROJECT_REF);
    }
  });

  it("fails closed when project scope is missing project_ref", () => {
    const result = mapCaptureRuntimePreferenceCandidateToEntityRecord({
      ...BASE_TIME_BOUNDED,
      scope: "project",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "missing_project_ref");
    }
  });

  it("fails closed when time_bounded mode omits expires_at", () => {
    const result = mapCaptureRuntimePreferenceCandidateToEntityRecord({
      ...BASE_TIME_BOUNDED,
      expiresAt: undefined,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "missing_expires_at");
    }
  });

  it("fails closed when source signal ids are missing or blank", () => {
    const missing = mapCaptureRuntimePreferenceCandidateToEntityRecord({
      ...BASE_TIME_BOUNDED,
      sourceSignalIds: [],
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.reason, "missing_source_signal_id");
    }

    const blank = mapCaptureRuntimePreferenceCandidateToEntityRecord({
      ...BASE_TIME_BOUNDED,
      sourceSignalIds: ["   "],
    });
    assert.equal(blank.ok, false);
    if (!blank.ok) {
      assert.equal(blank.reason, "missing_source_signal_id");
    }
  });

  it("fails closed when statement is empty", () => {
    const result = mapCaptureRuntimePreferenceCandidateToEntityRecord({
      ...BASE_TIME_BOUNDED,
      statement: "   ",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "invalid_statement");
    }
  });
});
