import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseFrame } from "../core/frame-schema.js";
import type { RuntimeSemanticEntityRecord } from "./entity-record.js";
import {
  planRuntimeGraduation,
  RUNTIME_GRADUATION_KIND_PROVENANCE,
  RUNTIME_GRADUATION_SOURCE_SURFACE,
} from "./graduation-planner.js";
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

const GENERATED_AT = FIXTURE_ISO;

function record(
  id: string,
  kind: RuntimeSemanticEntityRecord["kind"],
  payload: unknown,
  scope: RuntimeSemanticEntityRecord["scope"] = "user",
  projectRef?: string,
): RuntimeSemanticEntityRecord {
  return {
    id,
    kind,
    scope,
    ...(projectRef ? { project_ref: projectRef } : {}),
    payload,
  };
}

function assertFrameValid(frame: unknown): void {
  const parsed = parseFrame(frame);
  assert.equal(parsed.success, true, parsed.success ? undefined : parsed.error);
}

describe("planRuntimeGraduation", () => {
  it("preserves input order and summary counts", () => {
    const records = [
      record("pref-open", "runtime-preference-candidate", ACTIVE_PREFERENCE),
      record("dec-open", "unresolved-decision", OPEN_DECISION, "project", FIXTURE_PROJECT_REF),
      record("rej-1", "rejected-signal-log", REJECTED_SIGNAL, "project", FIXTURE_PROJECT_REF),
    ];

    const plan = planRuntimeGraduation({
      records,
      generatedAt: GENERATED_AT,
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.deepEqual(
      plan.decisions.map((decision) => decision.recordId),
      ["pref-open", "dec-open", "rej-1"],
    );
    assert.deepEqual(plan.summary, {
      graduate: 0,
      defer: 2,
      proposal_required: 0,
      skip: 1,
    });
    assert.equal(plan.generatedAt, GENERATED_AT);
  });

  it("does not mutate input records", () => {
    const records = [
      record("pref-open", "runtime-preference-candidate", ACTIVE_PREFERENCE),
    ];
    const snapshot = structuredClone(records);

    planRuntimeGraduation({ records, generatedAt: GENERATED_AT });
    assert.deepEqual(records, snapshot);
  });

  it("skips rows already marked graduated in runtime storage", () => {
    const plan = planRuntimeGraduation({
      records: [
        {
          ...record("pref-graduated", "runtime-preference-candidate", {
            ...ACTIVE_PREFERENCE,
            id: "pref-graduated",
            promotion_evidence: {
              ...ACTIVE_PREFERENCE.promotion_evidence,
              explicit_confirmation_signal_id: "confirm-1",
            },
          }),
          graduation_status: "graduated",
          graduated_at: GENERATED_AT,
        },
      ],
      generatedAt: GENERATED_AT,
    });

    assert.equal(plan.decisions[0]?.status, "skip");
    if (plan.decisions[0]?.status === "skip") {
      assert.equal(plan.decisions[0].reason, "already_graduated");
    }
    assert.deepEqual(plan.summary, {
      graduate: 0,
      defer: 0,
      proposal_required: 0,
      skip: 1,
    });
  });
});

describe("RuntimePreferenceCandidate graduation rules", () => {
  it("defers active preferences below promotion threshold", () => {
    const plan = planRuntimeGraduation({
      records: [record("pref-low", "runtime-preference-candidate", ACTIVE_PREFERENCE)],
      generatedAt: GENERATED_AT,
    });

    assert.equal(plan.decisions[0]?.status, "defer");
    if (plan.decisions[0]?.status === "defer") {
      assert.equal(plan.decisions[0].reason, "below_promotion_threshold");
    }
  });

  it("graduates active preferences with explicit confirmation", () => {
    const plan = planRuntimeGraduation({
      records: [
        record("pref-confirmed", "runtime-preference-candidate", {
          ...ACTIVE_PREFERENCE,
          id: "pref-confirmed",
          promotion_evidence: {
            ...ACTIVE_PREFERENCE.promotion_evidence,
            explicit_confirmation_signal_id: "confirm-1",
          },
        }),
      ],
      generatedAt: GENERATED_AT,
    });

    const decision = plan.decisions[0];
    assert.equal(decision?.status, "graduate");
    if (decision?.status === "graduate") {
      assert.equal(decision.reason, "explicit_confirmation");
      assertFrameValid(decision.targetFrame);
      assert.equal(decision.targetFrame.kind, "semantic");
      assert.equal(decision.targetFrame.source.surface, RUNTIME_GRADUATION_SOURCE_SURFACE);
      assert.equal(
        decision.targetFrame.kind_provenance?.default_basis,
        RUNTIME_GRADUATION_KIND_PROVENANCE.preferenceCandidate,
      );
      assert.equal(
        (decision.targetFrame.content as { source_runtime_entity_id?: string })
          .source_runtime_entity_id,
        "pref-confirmed",
      );
    }
  });

  it("graduates active preferences meeting repetition thresholds", () => {
    const plan = planRuntimeGraduation({
      records: [
        record("pref-repeat", "runtime-preference-candidate", {
          ...ACTIVE_PREFERENCE,
          id: "pref-repeat",
          promotion_evidence: {
            repetition_count: 3,
            independent_sessions: 2,
          },
        }),
      ],
      generatedAt: GENERATED_AT,
    });

    const decision = plan.decisions[0];
    assert.equal(decision?.status, "graduate");
    if (decision?.status === "graduate") {
      assert.equal(decision.reason, "repetition_threshold_met");
      assertFrameValid(decision.targetFrame);
    }
  });

  it("requires proposal for contradicted preferences", () => {
    const plan = planRuntimeGraduation({
      records: [
        record("pref-contradicted", "runtime-preference-candidate", {
          ...ACTIVE_PREFERENCE,
          status: "contradicted",
        }),
      ],
      generatedAt: GENERATED_AT,
    });

    assert.equal(plan.decisions[0]?.status, "proposal_required");
    if (plan.decisions[0]?.status === "proposal_required") {
      assert.equal(plan.decisions[0].reason, "contradicted_preference");
    }
  });

  it("defers expired preferences and skips promoted or abandoned ones", () => {
    const plan = planRuntimeGraduation({
      records: [
        record("pref-expired", "runtime-preference-candidate", {
          ...ACTIVE_PREFERENCE,
          id: "pref-expired",
          status: "expired",
        }),
        record("pref-promoted", "runtime-preference-candidate", {
          ...ACTIVE_PREFERENCE,
          id: "pref-promoted",
          status: "promoted",
        }),
        record("pref-abandoned", "runtime-preference-candidate", {
          ...ACTIVE_PREFERENCE,
          id: "pref-abandoned",
          status: "abandoned",
        }),
      ],
      generatedAt: GENERATED_AT,
    });

    assert.deepEqual(
      plan.decisions.map((decision) => decision.status),
      ["defer", "skip", "skip"],
    );
    if (plan.decisions[0]?.status === "defer") {
      assert.equal(plan.decisions[0].reason, "expired_preference");
    }
  });
});

describe("UnresolvedDecision graduation rules", () => {
  const decidedDecision = {
    ...OPEN_DECISION,
    status: "decided" as const,
    selected_option_id: "opt-1",
  };

  it("graduates decided decisions with valid selected options", () => {
    const plan = planRuntimeGraduation({
      records: [
        record(
          "dec-decided",
          "unresolved-decision",
          decidedDecision,
          "project",
          FIXTURE_PROJECT_REF,
        ),
      ],
      generatedAt: GENERATED_AT,
      projectRef: FIXTURE_PROJECT_REF,
    });

    const decision = plan.decisions[0];
    assert.equal(decision?.status, "graduate");
    if (decision?.status === "graduate") {
      assert.equal(decision.reason, "resolved_decision");
      assertFrameValid(decision.targetFrame);
      assert.equal(
        decision.targetFrame.kind_provenance?.default_basis,
        RUNTIME_GRADUATION_KIND_PROVENANCE.resolvedDecision,
      );
    }
  });

  it("defers open decisions and skips abandoned ones", () => {
    const plan = planRuntimeGraduation({
      records: [
        record("dec-open", "unresolved-decision", OPEN_DECISION, "project", FIXTURE_PROJECT_REF),
        record("dec-abandoned", "unresolved-decision", {
          ...OPEN_DECISION,
          id: "dec-abandoned",
          status: "abandoned",
        }, "project", FIXTURE_PROJECT_REF),
      ],
      generatedAt: GENERATED_AT,
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.deepEqual(
      plan.decisions.map((decision) => decision.status),
      ["defer", "skip"],
    );
    if (plan.decisions[0]?.status === "defer") {
      assert.equal(plan.decisions[0].reason, "open_decision");
    }
  });

  it("requires proposal for decided decisions with orphaned selected options", () => {
    const plan = planRuntimeGraduation({
      records: [
        record("dec-orphan", "unresolved-decision", {
          ...decidedDecision,
          selected_option_id: "missing-opt",
        }, "project", FIXTURE_PROJECT_REF),
      ],
      generatedAt: GENERATED_AT,
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(plan.decisions[0]?.status, "proposal_required");
    if (plan.decisions[0]?.status === "proposal_required") {
      assert.equal(plan.decisions[0].reason, "orphaned_decision_option");
    }
  });

  it("defers decided decisions with valid selected options but missing provenance", () => {
    const plan = planRuntimeGraduation({
      records: [
        record("dec-no-provenance", "unresolved-decision", {
          ...decidedDecision,
          id: "dec-no-provenance",
          provenance: [],
        }, "project", FIXTURE_PROJECT_REF),
      ],
      generatedAt: GENERATED_AT,
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(plan.decisions[0]?.status, "defer");
    if (plan.decisions[0]?.status === "defer") {
      assert.equal(plan.decisions[0].reason, "open_decision");
    }
  });
});

describe("RuntimeCrystalCandidate graduation rules", () => {
  const baseCrystal = {
    id: "hyp-1",
    claim: "Cursor works best for refactors in this repo",
    scope: "project" as const,
    project_ref: FIXTURE_PROJECT_REF,
    related_goal_ids: [],
    related_decision_ids: [],
    supporting_evidence_refs: ["evidence-a"],
    contradicting_evidence_refs: [],
    predicted_observations: ["prediction-a"],
    successful_predictions: ["prediction-a"],
    failed_predictions: [],
    confidence: "medium" as const,
    contradiction_score: "low" as const,
    pinned: false,
    first_observed_at: FIXTURE_ISO,
    last_referenced_at: FIXTURE_ISO,
    source_signal_ids: ["signal-crystal"],
    lineage: {
      generated_by: "agent" as const,
      transform_id: "crystal-v1",
    },
  };

  it("requires proposal for supported crystal candidates ready for promotion", () => {
    const plan = planRuntimeGraduation({
      records: [
        record("hyp-supported", "runtime-crystal-candidate", {
          ...baseCrystal,
          status: "supported",
        }, "project", FIXTURE_PROJECT_REF),
      ],
      generatedAt: GENERATED_AT,
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(plan.decisions[0]?.status, "proposal_required");
    if (plan.decisions[0]?.status === "proposal_required") {
      assert.equal(plan.decisions[0].reason, "crystal_promotion_ready");
    }
  });

  it("defers active and stale hypotheses and skips refuted or promoted ones", () => {
    const plan = planRuntimeGraduation({
      records: [
        record("hyp-active", "runtime-crystal-candidate", {
          ...baseCrystal,
          id: "hyp-active",
          status: "active",
        }, "project", FIXTURE_PROJECT_REF),
        record("hyp-stale", "runtime-crystal-candidate", {
          ...baseCrystal,
          id: "hyp-stale",
          status: "stale",
        }, "project", FIXTURE_PROJECT_REF),
        record("hyp-refuted", "runtime-crystal-candidate", {
          ...baseCrystal,
          id: "hyp-refuted",
          status: "refuted",
        }, "project", FIXTURE_PROJECT_REF),
        record("hyp-promoted", "runtime-crystal-candidate", {
          ...baseCrystal,
          id: "hyp-promoted",
          status: "promoted",
        }, "project", FIXTURE_PROJECT_REF),
      ],
      generatedAt: GENERATED_AT,
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.deepEqual(
      plan.decisions.map((decision) => decision.status),
      ["defer", "defer", "skip", "skip"],
    );
  });

  it("defers supported crystal candidates that lack promotion-ready evidence", () => {
    const plan = planRuntimeGraduation({
      records: [
        record("hyp-supported-not-ready", "runtime-crystal-candidate", {
          ...baseCrystal,
          id: "hyp-supported-not-ready",
          status: "supported",
          successful_predictions: [],
          source_signal_ids: [],
          lineage: {
            generated_by: "agent" as const,
          },
        }, "project", FIXTURE_PROJECT_REF),
      ],
      generatedAt: GENERATED_AT,
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(plan.decisions[0]?.status, "defer");
    if (plan.decisions[0]?.status === "defer") {
      assert.equal(plan.decisions[0].reason, "supported_hypothesis_not_ready");
    }
  });

  it("skips abandoned crystal candidates", () => {
    const plan = planRuntimeGraduation({
      records: [
        record("hyp-abandoned", "runtime-crystal-candidate", {
          ...baseCrystal,
          id: "hyp-abandoned",
          status: "abandoned",
        }, "project", FIXTURE_PROJECT_REF),
      ],
      generatedAt: GENERATED_AT,
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(plan.decisions[0]?.status, "skip");
    if (plan.decisions[0]?.status === "skip") {
      assert.equal(plan.decisions[0].reason, "abandoned");
    }
  });

  it("defers supported crystals with whitespace-only transform_id and no source signals", () => {
    const plan = planRuntimeGraduation({
      records: [
        record("hyp-whitespace-lineage", "runtime-crystal-candidate", {
          ...baseCrystal,
          id: "hyp-whitespace-lineage",
          status: "supported",
          source_signal_ids: [],
          lineage: {
            generated_by: "agent" as const,
            transform_id: "   ",
          },
        }, "project", FIXTURE_PROJECT_REF),
      ],
      generatedAt: GENERATED_AT,
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(plan.decisions[0]?.status, "defer");
    if (plan.decisions[0]?.status === "defer") {
      assert.equal(plan.decisions[0].reason, "supported_hypothesis_not_ready");
    }
  });

  it("requires proposal when lineage comes from transform_id alone", () => {
    const plan = planRuntimeGraduation({
      records: [
        record("hyp-transform-lineage", "runtime-crystal-candidate", {
          ...baseCrystal,
          id: "hyp-transform-lineage",
          status: "supported",
          source_signal_ids: ["", "  "],
          lineage: {
            generated_by: "agent" as const,
            transform_id: "crystal-v1",
          },
        }, "project", FIXTURE_PROJECT_REF),
      ],
      generatedAt: GENERATED_AT,
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(plan.decisions[0]?.status, "proposal_required");
    if (plan.decisions[0]?.status === "proposal_required") {
      assert.equal(plan.decisions[0].reason, "crystal_promotion_ready");
    }
  });

  it("requires proposal when lineage comes from source signals alone", () => {
    const plan = planRuntimeGraduation({
      records: [
        record("hyp-signal-lineage", "runtime-crystal-candidate", {
          ...baseCrystal,
          id: "hyp-signal-lineage",
          status: "supported",
          source_signal_ids: ["signal-crystal"],
          lineage: {
            generated_by: "agent" as const,
          },
        }, "project", FIXTURE_PROJECT_REF),
      ],
      generatedAt: GENERATED_AT,
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(plan.decisions[0]?.status, "proposal_required");
    if (plan.decisions[0]?.status === "proposal_required") {
      assert.equal(plan.decisions[0].reason, "crystal_promotion_ready");
    }
  });
});

describe("Non-graduating runtime entity kinds", () => {
  it("skips audit, beacon, and sub-entity records", () => {
    const plan = planRuntimeGraduation({
      records: [
        record("rej-1", "rejected-signal-log", REJECTED_SIGNAL, "project", FIXTURE_PROJECT_REF),
        record("snap-1", "dormant-snapshot", DORMANT_SNAPSHOT),
        record("lean-1", "current-decision-leaning", CURRENT_DECISION_LEANING),
      ],
      generatedAt: GENERATED_AT,
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.deepEqual(
      plan.decisions.map((decision) => [decision.status, decision.reason]),
      [
        ["skip", "audit_only"],
        ["skip", "retrieval_beacon_only"],
        ["skip", "sub_entity_only"],
      ],
    );
  });

  it("defers episodic frames and harness operational state", () => {
    const plan = planRuntimeGraduation({
      records: [
        record("frame-1", "episodic-frame", TRACEABLE_EPISODIC_FRAME),
        record("harness-active", "harness-operational-state", {
          id: "harness-1",
          harness: "cursor",
          status: "active",
          observed_at: FIXTURE_ISO,
          source_signal_ids: ["signal-harness"],
        }),
        record("harness-closed", "harness-operational-state", {
          id: "harness-2",
          harness: "cursor",
          status: "closed",
          observed_at: FIXTURE_ISO,
          source_signal_ids: ["signal-harness-closed"],
        }),
      ],
      generatedAt: GENERATED_AT,
    });

    assert.deepEqual(
      plan.decisions.map((decision) =>
        decision.status === "defer" ? decision.reason : decision.status,
      ),
      [
        "episodic_mapper_not_implemented",
        "active_harness_state",
        "episodic_mapper_not_implemented",
      ],
    );
  });
});

describe("Preflight validation", () => {
  it("skips invalid payloads", () => {
    const plan = planRuntimeGraduation({
      records: [
        record("pref-bad", "runtime-preference-candidate", {
          ...ACTIVE_PREFERENCE,
          mode: "permanent",
        }),
      ],
      generatedAt: GENERATED_AT,
    });

    assert.equal(plan.decisions[0]?.status, "skip");
    if (plan.decisions[0]?.status === "skip") {
      assert.equal(plan.decisions[0].reason, "invalid_input");
    }
  });

  it("skips project scope mismatches when projectRef is provided", () => {
    const plan = planRuntimeGraduation({
      records: [
        record(
          "dec-other-project",
          "unresolved-decision",
          OPEN_DECISION,
          "project",
          "other-project",
        ),
      ],
      generatedAt: GENERATED_AT,
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(plan.decisions[0]?.status, "skip");
    if (plan.decisions[0]?.status === "skip") {
      assert.equal(plan.decisions[0].reason, "scope_mismatch");
    }
  });

  it("skips project-scoped records missing record.project_ref", () => {
    const plan = planRuntimeGraduation({
      records: [
        record("dec-missing-project-ref", "unresolved-decision", OPEN_DECISION, "project"),
      ],
      generatedAt: GENERATED_AT,
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(plan.decisions[0]?.status, "skip");
    if (plan.decisions[0]?.status === "skip") {
      assert.equal(plan.decisions[0].reason, "missing_record_project_ref");
    }
  });
});
