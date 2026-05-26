import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseRuntimeSemanticEntityRecordFromUnknown,
  safeParseRuntimeSemanticEntityRecordFromUnknown,
} from "./entity-record-parse.js";
import {
  ACTIVE_PREFERENCE,
  FIXTURE_ISO,
  FIXTURE_PROJECT_REF,
  VALID_ACTIVE_PREFERENCE_RECORD,
} from "./runtime-semantics.test-fixture.js";

describe("safeParseRuntimeSemanticEntityRecordFromUnknown", () => {
  it("rejects non-object input", () => {
    for (const value of [null, "string", 42, true]) {
      const result = safeParseRuntimeSemanticEntityRecordFromUnknown(value);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "invalid_record_shape");
        assert.match(result.message, /non-null object/i);
      }
    }
  });

  it("rejects arrays as records", () => {
    const result = safeParseRuntimeSemanticEntityRecordFromUnknown([]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "invalid_record_shape");
    }
  });

  it("rejects missing id, kind, scope, and payload", () => {
    assert.equal(
      safeParseRuntimeSemanticEntityRecordFromUnknown({
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: ACTIVE_PREFERENCE,
      }).ok,
      false,
    );
    assert.equal(
      safeParseRuntimeSemanticEntityRecordFromUnknown({
        id: "pref-1",
        scope: "user",
        payload: ACTIVE_PREFERENCE,
      }).ok,
      false,
    );
    assert.equal(
      safeParseRuntimeSemanticEntityRecordFromUnknown({
        id: "pref-1",
        kind: "runtime-preference-candidate",
        payload: ACTIVE_PREFERENCE,
      }).ok,
      false,
    );
    assert.equal(
      safeParseRuntimeSemanticEntityRecordFromUnknown({
        id: "pref-1",
        kind: "runtime-preference-candidate",
        scope: "user",
      }).ok,
      false,
    );
  });

  it("rejects invalid optional fields", () => {
    const projectRefResult = safeParseRuntimeSemanticEntityRecordFromUnknown({
      ...VALID_ACTIVE_PREFERENCE_RECORD,
      project_ref: 123,
    });
    assert.equal(projectRefResult.ok, false);
    if (!projectRefResult.ok) {
      assert.equal(projectRefResult.reason, "invalid_record_shape");
      assert.equal(projectRefResult.id, "pref-1");
      assert.match(projectRefResult.message, /project_ref/);
    }

    const observedAtResult = safeParseRuntimeSemanticEntityRecordFromUnknown({
      ...VALID_ACTIVE_PREFERENCE_RECORD,
      observed_at: { at: FIXTURE_ISO },
    });
    assert.equal(observedAtResult.ok, false);
    if (!observedAtResult.ok) {
      assert.equal(observedAtResult.reason, "invalid_record_shape");
      assert.match(observedAtResult.message, /observed_at/);
    }
  });

  it("accepts a valid record with optional fields", () => {
    const result = safeParseRuntimeSemanticEntityRecordFromUnknown({
      ...VALID_ACTIVE_PREFERENCE_RECORD,
      project_ref: FIXTURE_PROJECT_REF,
      observed_at: FIXTURE_ISO,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.record.id, "pref-1");
      assert.equal(result.record.project_ref, FIXTURE_PROJECT_REF);
      assert.equal(result.record.observed_at, FIXTURE_ISO);
    }
  });

  it("reports semantic validation failures", () => {
    const result = safeParseRuntimeSemanticEntityRecordFromUnknown({
      id: "dec-bad",
      kind: "unresolved-decision",
      scope: "project",
      project_ref: FIXTURE_PROJECT_REF,
      payload: { id: "dec-bad" },
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "invalid_input");
      assert.equal(result.id, "dec-bad");
    }
  });
});

describe("parseRuntimeSemanticEntityRecordFromUnknown", () => {
  it("returns the parsed record on success", () => {
    const record = parseRuntimeSemanticEntityRecordFromUnknown(VALID_ACTIVE_PREFERENCE_RECORD);
    assert.equal(record.id, "pref-1");
    assert.equal(record.kind, "runtime-preference-candidate");
  });

  it("throws on envelope failure", () => {
    assert.throws(
      () => parseRuntimeSemanticEntityRecordFromUnknown(null),
      /non-null object/i,
    );
  });
});
