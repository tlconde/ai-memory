import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { RuntimeSemanticEntityRecord } from "./entity-record.js";
import { validateRuntimeSemanticEntityWriteProvenance } from "./provenance-validation.js";
import {
  ACTIVE_PREFERENCE,
  CURRENT_DECISION_LEANING,
  DORMANT_SNAPSHOT,
  FIXTURE_ISO,
  FIXTURE_PROJECT_REF,
  OPEN_DECISION,
  REJECTED_SIGNAL,
  TRACEABLE_EPISODIC_FRAME,
} from "./runtime-semantics.test-fixture.js";

function record(
  kind: RuntimeSemanticEntityRecord["kind"],
  payload: unknown,
): RuntimeSemanticEntityRecord {
  return {
    id: "record-1",
    kind,
    scope: "user",
    payload,
  };
}

const TRACEABLE_CRYSTAL = {
  id: "hyp-1",
  claim: "Cursor works best for refactors in this repo",
  status: "active" as const,
  scope: "project" as const,
  project_ref: FIXTURE_PROJECT_REF,
  related_goal_ids: [],
  related_decision_ids: [],
  supporting_evidence_refs: [],
  contradicting_evidence_refs: [],
  predicted_observations: [],
  successful_predictions: [],
  failed_predictions: [],
  confidence: "low" as const,
  contradiction_score: "low" as const,
  pinned: false,
  first_observed_at: FIXTURE_ISO,
  last_referenced_at: FIXTURE_ISO,
  source_signal_ids: [],
  lineage: {
    generated_by: "agent" as const,
    transform_id: "runtime-crystal.v1",
  },
};

const TRACEABLE_HARNESS_STATE = {
  id: "harness-1",
  harness: "cursor",
  status: "active" as const,
  observed_at: FIXTURE_ISO,
  source_signal_ids: ["signal-harness-1"],
};

describe("validateRuntimeSemanticEntityWriteProvenance", () => {
  it("requires transform provenance for episodic frames", () => {
    const missing = validateRuntimeSemanticEntityWriteProvenance(
      record("episodic-frame", {
        ...TRACEABLE_EPISODIC_FRAME,
        provenance: {},
      }),
    );
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.reason, "missing_provenance_transform_id");
    }

    const blank = validateRuntimeSemanticEntityWriteProvenance(
      record("episodic-frame", {
        ...TRACEABLE_EPISODIC_FRAME,
        provenance: { transform_id: "   " },
      }),
    );
    assert.equal(blank.ok, false);

    assert.deepEqual(
      validateRuntimeSemanticEntityWriteProvenance(
        record("episodic-frame", TRACEABLE_EPISODIC_FRAME),
      ),
      { ok: true },
    );
  });

  it("requires schema-native source signals for preferences and leanings", () => {
    const missingPreference = validateRuntimeSemanticEntityWriteProvenance(
      record("runtime-preference-candidate", {
        ...ACTIVE_PREFERENCE,
        source_signal_ids: [],
      }),
    );
    assert.equal(missingPreference.ok, false);
    if (!missingPreference.ok) {
      assert.equal(missingPreference.reason, "missing_source_signal_ids");
    }

    const blankPreference = validateRuntimeSemanticEntityWriteProvenance(
      record("runtime-preference-candidate", {
        ...ACTIVE_PREFERENCE,
        source_signal_ids: ["   "],
      }),
    );
    assert.equal(blankPreference.ok, false);

    const blankLeaning = validateRuntimeSemanticEntityWriteProvenance(
      record("current-decision-leaning", {
        ...CURRENT_DECISION_LEANING,
        source_signal_id: "   ",
      }),
    );
    assert.equal(blankLeaning.ok, false);
    if (!blankLeaning.ok) {
      assert.equal(blankLeaning.reason, "missing_source_signal_id");
    }

    assert.deepEqual(
      validateRuntimeSemanticEntityWriteProvenance(
        record("runtime-preference-candidate", ACTIVE_PREFERENCE),
      ),
      { ok: true },
    );
    assert.deepEqual(
      validateRuntimeSemanticEntityWriteProvenance(
        record("current-decision-leaning", CURRENT_DECISION_LEANING),
      ),
      { ok: true },
    );
  });

  it("requires provenance refs for decisions", () => {
    const missing = validateRuntimeSemanticEntityWriteProvenance(
      record("unresolved-decision", {
        ...OPEN_DECISION,
        provenance: [],
      }),
    );
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.reason, "missing_provenance_refs");
    }

    assert.deepEqual(
      validateRuntimeSemanticEntityWriteProvenance(
        record("unresolved-decision", OPEN_DECISION),
      ),
      { ok: true },
    );
  });

  it("accepts runtime crystal lineage via source signals or transform id", () => {
    const missing = validateRuntimeSemanticEntityWriteProvenance(
      record("runtime-crystal-candidate", {
        ...TRACEABLE_CRYSTAL,
        source_signal_ids: [],
        lineage: { generated_by: "agent" },
      }),
    );
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.reason, "missing_source_signal_ids");
    }

    assert.deepEqual(
      validateRuntimeSemanticEntityWriteProvenance(
        record("runtime-crystal-candidate", TRACEABLE_CRYSTAL),
      ),
      { ok: true },
    );
    assert.deepEqual(
      validateRuntimeSemanticEntityWriteProvenance(
        record("runtime-crystal-candidate", {
          ...TRACEABLE_CRYSTAL,
          source_signal_ids: ["signal-crystal-1"],
          lineage: { generated_by: "agent" },
        }),
      ),
      { ok: true },
    );
  });

  it("requires source signals for harness operational state", () => {
    const missing = validateRuntimeSemanticEntityWriteProvenance(
      record("harness-operational-state", {
        ...TRACEABLE_HARNESS_STATE,
        source_signal_ids: [],
      }),
    );
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.reason, "missing_source_signal_ids");
    }

    assert.deepEqual(
      validateRuntimeSemanticEntityWriteProvenance(
        record("harness-operational-state", TRACEABLE_HARNESS_STATE),
      ),
      { ok: true },
    );
  });

  it("exempts rejected signal logs and dormant snapshots from facade provenance gates", () => {
    assert.deepEqual(
      validateRuntimeSemanticEntityWriteProvenance(
        record("rejected-signal-log", REJECTED_SIGNAL),
      ),
      { ok: true },
    );
    assert.deepEqual(
      validateRuntimeSemanticEntityWriteProvenance(
        record("dormant-snapshot", DORMANT_SNAPSHOT),
      ),
      { ok: true },
    );
  });
});
