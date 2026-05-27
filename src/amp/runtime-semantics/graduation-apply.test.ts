import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { parseFrame } from "../core/frame-schema.js";
import type { RuntimeSemanticEntityRecord } from "./entity-record.js";
import { applyRuntimeGraduationDecision } from "./graduation-apply.js";
import { planRuntimeGraduation } from "./graduation-planner.js";
import {
  ACTIVE_PREFERENCE,
  FIXTURE_ISO,
  FIXTURE_PROJECT_REF,
  OPEN_DECISION,
} from "./runtime-semantics.test-fixture.js";

const GENERATED_AT = FIXTURE_ISO;

const SUPPORTED_CRYSTAL = {
  id: "hyp-ready",
  claim: "Cursor works best for refactors in this repo",
  status: "supported" as const,
  scope: "project" as const,
  project_ref: FIXTURE_PROJECT_REF,
  related_goal_ids: [] as string[],
  related_decision_ids: [] as string[],
  supporting_evidence_refs: ["evidence-a"],
  contradicting_evidence_refs: [] as string[],
  predicted_observations: ["prediction-a"],
  successful_predictions: ["prediction-a"],
  failed_predictions: [] as string[],
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

describe("applyRuntimeGraduationDecision", () => {
  it("writes one semantic frame for an explicitly confirmed preference candidate", () => {
    const knowledge = new InMemoryKnowledgeStore();
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

    const result = applyRuntimeGraduationDecision({
      recordId: "pref-confirmed",
      plan,
      knowledgeStore: knowledge,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.appliedFrameId, "runtime-graduation:pref-confirmed");
      assert.equal(result.decision.reason, "explicit_confirmation");
      assert.equal(result.runtimeRowMutated, false);
    }

    const frames = knowledge.list();
    assert.equal(frames.length, 1);
    assert.equal(frames[0]?.kind, "semantic");
    assert.equal(parseFrame(frames[0]).success, true);
  });

  it("applies repetition-threshold preference candidates with repetition_threshold_met reason", () => {
    const knowledge = new InMemoryKnowledgeStore();
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

    const result = applyRuntimeGraduationDecision({
      recordId: "pref-repeat",
      plan,
      knowledgeStore: knowledge,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.decision.reason, "repetition_threshold_met");
    }
  });

  it("fails for contradicted preferences because the planner requires a proposal", () => {
    const knowledge = new InMemoryKnowledgeStore();
    const plan = planRuntimeGraduation({
      records: [
        record("pref-contradicted", "runtime-preference-candidate", {
          ...ACTIVE_PREFERENCE,
          id: "pref-contradicted",
          status: "contradicted",
        }),
      ],
      generatedAt: GENERATED_AT,
    });

    const result = applyRuntimeGraduationDecision({
      recordId: "pref-contradicted",
      plan,
      knowledgeStore: knowledge,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "decision_not_graduate");
      assert.equal(result.decision?.status, "proposal_required");
      assert.equal(knowledge.list().length, 0);
    }
  });

  it("fails for proposal-ready crystal candidates", () => {
    const knowledge = new InMemoryKnowledgeStore();
    const plan = planRuntimeGraduation({
      records: [
        record("hyp-ready", "runtime-crystal-candidate", SUPPORTED_CRYSTAL, "project", FIXTURE_PROJECT_REF),
      ],
      generatedAt: GENERATED_AT,
      projectRef: FIXTURE_PROJECT_REF,
    });

    const result = applyRuntimeGraduationDecision({
      recordId: "hyp-ready",
      plan,
      knowledgeStore: knowledge,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "decision_not_graduate");
      assert.equal(result.decision?.status, "proposal_required");
      assert.equal(knowledge.list().length, 0);
    }
  });

  it("fails when the record id is missing from the plan", () => {
    const knowledge = new InMemoryKnowledgeStore();
    const plan = planRuntimeGraduation({
      records: [],
      generatedAt: GENERATED_AT,
    });

    const result = applyRuntimeGraduationDecision({
      recordId: "missing-id",
      plan,
      knowledgeStore: knowledge,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "record_not_found");
    }
  });

  it("fails closed on duplicate durable frame ids", () => {
    const knowledge = new InMemoryKnowledgeStore();
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

    const first = applyRuntimeGraduationDecision({
      recordId: "pref-confirmed",
      plan,
      knowledgeStore: knowledge,
    });
    assert.equal(first.ok, true);

    const duplicate = applyRuntimeGraduationDecision({
      recordId: "pref-confirmed",
      plan,
      knowledgeStore: knowledge,
    });

    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) {
      assert.equal(duplicate.reason, "duplicate_frame_id");
      assert.equal(knowledge.list().length, 1);
    }
  });

  it("preserves project scope and project_ref on written frames", () => {
    const knowledge = new InMemoryKnowledgeStore();
    const plan = planRuntimeGraduation({
      records: [
        record(
          "pref-project",
          "runtime-preference-candidate",
          {
            ...ACTIVE_PREFERENCE,
            id: "pref-project",
            scope: "project",
            project_ref: FIXTURE_PROJECT_REF,
            promotion_evidence: {
              ...ACTIVE_PREFERENCE.promotion_evidence,
              explicit_confirmation_signal_id: "confirm-1",
            },
          },
          "project",
          FIXTURE_PROJECT_REF,
        ),
      ],
      generatedAt: GENERATED_AT,
      projectRef: FIXTURE_PROJECT_REF,
    });

    const result = applyRuntimeGraduationDecision({
      recordId: "pref-project",
      plan,
      knowledgeStore: knowledge,
    });

    assert.equal(result.ok, true);
    const frame = knowledge.list()[0];
    assert.equal(frame?.scope.kind, "project");
    if (frame?.scope.kind === "project") {
      assert.equal(frame.scope.project_ref, FIXTURE_PROJECT_REF);
    }
  });

  it("rejects unresolved decisions even when the planner would graduate them", () => {
    const knowledge = new InMemoryKnowledgeStore();
    const plan = planRuntimeGraduation({
      records: [
        record(
          "dec-decided",
          "unresolved-decision",
          {
            ...OPEN_DECISION,
            status: "decided",
            selected_option_id: "opt-1",
          },
          "project",
          FIXTURE_PROJECT_REF,
        ),
      ],
      generatedAt: GENERATED_AT,
      projectRef: FIXTURE_PROJECT_REF,
    });

    const result = applyRuntimeGraduationDecision({
      recordId: "dec-decided",
      plan,
      knowledgeStore: knowledge,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "wrong_runtime_kind");
      assert.equal(knowledge.list().length, 0);
    }
  });
});
