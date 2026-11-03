import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseCurrentDecisionLeaning,
  parseDormantSnapshot,
  parseEpisodicFrame,
  parseHarnessOperationalState,
  parseRejectedSignalLog,
  parseRuntimeCrystalCandidate,
  parseRuntimePreferenceCandidate,
  parseUnresolvedDecision,
  safeParseEpisodicFrame,
  safeParseRejectedSignalLog,
  safeParseRuntimeCrystalCandidate,
  safeParseRuntimePreferenceCandidate,
  safeParseUnresolvedDecision,
} from "./schema.js";

const ISO = "2026-05-26T12:00:00.000Z";

const MINIMAL_UNRESOLVED_DECISION = {
  id: "dec-1",
  question: "Which storage backend?",
  status: "open" as const,
  scope: "user" as const,
  options: [
    {
      id: "opt-1",
      label: "SQLite",
      tradeoffs: ["local only"],
      evidence_refs: ["evidence-1"],
    },
  ],
  urgency: "medium" as const,
  owner: "user" as const,
  created_at: ISO,
  last_touched_at: ISO,
  provenance: ["signal-1"],
};

const MINIMAL_CURRENT_DECISION_LEANING = {
  decision_id: "dec-1",
  option_id: "opt-1",
  observed_at: ISO,
  source_signal_id: "signal-2",
  freshness: "fresh" as const,
};

const MINIMAL_RUNTIME_PREFERENCE = {
  id: "pref-1",
  statement: "Keep responses short today",
  mode: "time_bounded" as const,
  scope: "user" as const,
  context: {},
  status: "active" as const,
  first_observed_at: ISO,
  last_observed_at: ISO,
  source_signal_ids: ["signal-3"],
  confidence: "medium" as const,
  promotion_evidence: {
    repetition_count: 0,
    independent_sessions: 0,
  },
};

const MINIMAL_RUNTIME_CRYSTAL = {
  id: "hyp-1",
  claim: "Cursor works best for refactors in this repo",
  status: "active" as const,
  scope: "project" as const,
  project_ref: "ai-memory",
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
  first_observed_at: ISO,
  last_referenced_at: ISO,
  source_signal_ids: [],
  lineage: {
    generated_by: "agent" as const,
  },
};

const MINIMAL_HARNESS_STATE = {
  id: "harness-1",
  harness: "cursor",
  status: "active" as const,
  observed_at: ISO,
  source_signal_ids: ["signal-4"],
};

const MINIMAL_REJECTED_SIGNAL = {
  rejected_signal_id: "rej-1",
  timestamp: ISO,
  reason_code: "telemetry_without_semantic_content",
  source_surface: "cursor",
  scope: "project" as const,
  source_hash: "sha256:abc123",
};

const MINIMAL_EPISODIC_FRAME = {
  id: "frame-1",
  event_type: "correction" as const,
  summary: "User corrected the storage approach",
  tags: [],
  scope: "user" as const,
  curation_mode: "personal" as const,
  occurred_at: ISO,
  recorded_at: ISO,
  source_signals: ["signal-5"],
  related_entities: {},
  evidence_refs: [],
  provenance: {},
  confidence: "high" as const,
  source: "user_explicit" as const,
  sensitivity: "normal" as const,
  visibility: "user_private" as const,
  pinned: false,
  lifecycle_state: "active" as const,
};

const MINIMAL_DORMANT_SNAPSHOT = {
  frame_id: "frame-1",
  snapshot_version: 1,
  event_type: "correction" as const,
  summary_compressed: "Storage backend correction",
  key_terms: ["storage", "correction"],
  encoding_context: {
    goal_ids: ["goal-1"],
    session_ids: ["session-1"],
  },
  related_entities_compressed: {
    goal_ids: ["goal-1"],
    decision_ids: [],
    hypothesis_ids: [],
  },
  occurred_at: ISO,
  dormancy_entered_at: ISO,
  embedding: [0.1, 0.2],
  source: "user_explicit" as const,
  confidence_at_dormancy: "high" as const,
  activation_history: {
    times_activated: 2,
    last_activated_at: ISO,
  },
  generated_by: {
    transform_id: "dormant-snapshot-v1",
    cache_key: "sha256:snapshot-key",
  },
};

describe("runtime-semantics schemas", () => {
  it("accepts minimal valid UnresolvedDecision", () => {
    const decision = parseUnresolvedDecision(MINIMAL_UNRESOLVED_DECISION);
    assert.equal(decision.id, "dec-1");
    assert.equal(decision.options[0]?.label, "SQLite");
  });

  it("accepts minimal valid CurrentDecisionLeaning", () => {
    const leaning = parseCurrentDecisionLeaning(MINIMAL_CURRENT_DECISION_LEANING);
    assert.equal(leaning.decision_id, "dec-1");
    assert.equal(leaning.freshness, "fresh");
  });

  it("accepts minimal valid RuntimePreferenceCandidate", () => {
    const preference = parseRuntimePreferenceCandidate(MINIMAL_RUNTIME_PREFERENCE);
    assert.equal(preference.mode, "time_bounded");
  });

  it("accepts minimal valid RuntimeCrystalCandidate", () => {
    const crystal = parseRuntimeCrystalCandidate(MINIMAL_RUNTIME_CRYSTAL);
    assert.equal(crystal.contradiction_score, "low");
  });

  it("accepts minimal valid HarnessOperationalState", () => {
    const harness = parseHarnessOperationalState(MINIMAL_HARNESS_STATE);
    assert.equal(harness.harness, "cursor");
  });

  it("accepts minimal valid RejectedSignalLog", () => {
    const rejected = parseRejectedSignalLog(MINIMAL_REJECTED_SIGNAL);
    assert.equal(rejected.reason_code, "telemetry_without_semantic_content");
  });

  it("accepts minimal valid EpisodicFrame", () => {
    const frame = parseEpisodicFrame(MINIMAL_EPISODIC_FRAME);
    assert.equal(frame.event_type, "correction");
  });

  it("accepts skill_optimized episodic event_type", () => {
    const frame = parseEpisodicFrame({
      ...MINIMAL_EPISODIC_FRAME,
      event_type: "skill_optimized",
      summary: 'Skill "test-skill" optimized (1.0.0 -> 1.0.1).',
      details: {
        skill_name: "test-skill",
        version_before: "1.0.0",
        version_after: "1.0.1",
      },
    });
    assert.equal(frame.event_type, "skill_optimized");
  });

  it("accepts skill_optimization_rejected episodic event_type", () => {
    const frame = parseEpisodicFrame({
      ...MINIMAL_EPISODIC_FRAME,
      event_type: "skill_optimization_rejected",
      summary: 'Skill "test-skill" optimization rejected at cycle 1.',
      details: {
        skill_name: "test-skill",
        reject_reason: "Holdout score did not strictly improve",
      },
    });
    assert.equal(frame.event_type, "skill_optimization_rejected");
  });

  it("accepts minimal valid DormantSnapshot", () => {
    const snapshot = parseDormantSnapshot(MINIMAL_DORMANT_SNAPSHOT);
    assert.equal(snapshot.snapshot_version, 1);
  });

  it("rejects unknown EpisodicFrame.event_type", () => {
    const parsed = safeParseEpisodicFrame({
      ...MINIMAL_EPISODIC_FRAME,
      event_type: "mystery_event",
    });
    assert.equal(parsed.success, false);
  });

  it("rejects project-scoped EpisodicFrame without project_ref", () => {
    const parsed = safeParseEpisodicFrame({
      ...MINIMAL_EPISODIC_FRAME,
      scope: "project",
    });
    assert.equal(parsed.success, false);
    if (parsed.success) return;
    assert.match(parsed.error, /project scope requires project_ref/);
  });

  it("rejects deleted EpisodicFrame without deleted_at or deleted_reason", () => {
    const missingDeletedAt = safeParseEpisodicFrame({
      ...MINIMAL_EPISODIC_FRAME,
      lifecycle_state: "deleted",
      deleted_reason: "operator forget",
    });
    assert.equal(missingDeletedAt.success, false);
    if (missingDeletedAt.success) return;
    assert.match(missingDeletedAt.error, /deleted lifecycle_state requires deleted_at/);

    const missingDeletedReason = safeParseEpisodicFrame({
      ...MINIMAL_EPISODIC_FRAME,
      lifecycle_state: "deleted",
      deleted_at: ISO,
    });
    assert.equal(missingDeletedReason.success, false);
    if (missingDeletedReason.success) return;
    assert.match(missingDeletedReason.error, /deleted lifecycle_state requires deleted_reason/);
  });

  it("accepts secret_redacted frame with minimal details", () => {
    const frame = parseEpisodicFrame({
      ...MINIMAL_EPISODIC_FRAME,
      sensitivity: "secret_redacted",
      details: { redaction_note: "payload removed" },
    });
    assert.equal(frame.sensitivity, "secret_redacted");
    assert.deepEqual(frame.details, { redaction_note: "payload removed" });
  });

  it("rejects RejectedSignalLog with raw_content (strict unknown key)", () => {
    const parsed = safeParseRejectedSignalLog({
      ...MINIMAL_REJECTED_SIGNAL,
      raw_content: "secret-token-value",
    });
    assert.equal(parsed.success, false);
  });

  it("accepts DormantSnapshot with activation history", () => {
    const snapshot = parseDormantSnapshot({
      ...MINIMAL_DORMANT_SNAPSHOT,
      activation_history: {
        times_activated: 5,
        last_activated_at: ISO,
      },
    });
    assert.equal(snapshot.activation_history.times_activated, 5);
    assert.equal(snapshot.activation_history.last_activated_at, ISO);
  });

  it("rejects RuntimePreferenceCandidate with invalid mode", () => {
    const parsed = safeParseRuntimePreferenceCandidate({
      ...MINIMAL_RUNTIME_PREFERENCE,
      mode: "permanent",
    });
    assert.equal(parsed.success, false);
  });

  it("rejects RuntimeCrystalCandidate with invalid contradiction_score", () => {
    const parsed = safeParseRuntimeCrystalCandidate({
      ...MINIMAL_RUNTIME_CRYSTAL,
      contradiction_score: "critical",
    });
    assert.equal(parsed.success, false);
  });

  it("proves CurrentDecisionLeaning is not embedded in UnresolvedDecision schema", () => {
    const parsed = safeParseUnresolvedDecision({
      ...MINIMAL_UNRESOLVED_DECISION,
      current_leaning: MINIMAL_CURRENT_DECISION_LEANING,
    });
    assert.equal(parsed.success, false);
  });
});

type ScopeSafeParse = (input: unknown) => { success: boolean; error?: string };

const SCOPE_REF_ENTITIES: Array<{
  name: string;
  minimal: Record<string, unknown>;
  safeParse: ScopeSafeParse;
}> = [
  {
    name: "EpisodicFrame",
    minimal: MINIMAL_EPISODIC_FRAME,
    safeParse: safeParseEpisodicFrame,
  },
  {
    name: "RuntimePreferenceCandidate",
    minimal: MINIMAL_RUNTIME_PREFERENCE,
    safeParse: safeParseRuntimePreferenceCandidate,
  },
  {
    name: "RuntimeCrystalCandidate",
    minimal: MINIMAL_RUNTIME_CRYSTAL,
    safeParse: safeParseRuntimeCrystalCandidate,
  },
];

describe("scope and project_ref symmetry", () => {
  for (const { name, minimal, safeParse } of SCOPE_REF_ENTITIES) {
    it(`rejects ${name} with project scope and no project_ref`, () => {
      const parsed = safeParse({
        ...minimal,
        scope: "project",
        project_ref: undefined,
      });
      assert.equal(parsed.success, false);
      if (parsed.success) return;
      assert.match(parsed.error!, /project scope requires project_ref/);
    });

    it(`rejects ${name} with user scope and project_ref`, () => {
      const parsed = safeParse({
        ...minimal,
        scope: "user",
        project_ref: "ai-memory",
      });
      assert.equal(parsed.success, false);
      if (parsed.success) return;
      assert.match(parsed.error!, /project_ref is only valid for project scope/);
    });

    it(`rejects ${name} with universal scope and project_ref`, () => {
      const parsed = safeParse({
        ...minimal,
        scope: "universal",
        project_ref: "ai-memory",
      });
      assert.equal(parsed.success, false);
      if (parsed.success) return;
      assert.match(parsed.error!, /project_ref is only valid for project scope/);
    });
  }
});

describe("strict unknown-key rejection", () => {
  it("rejects EpisodicFrame with unknown metadata key", () => {
    const parsed = safeParseEpisodicFrame({
      ...MINIMAL_EPISODIC_FRAME,
      unexpected_field: true,
    });
    assert.equal(parsed.success, false);
  });
});
