import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  formatEpisodicFrameForRuntime,
  formatHarnessOperationalStateForRuntime,
  formatRejectedSignalLogForRuntime,
  formatRuntimeCrystalCandidateForRuntime,
  formatRuntimePreferenceCandidateForRuntime,
  formatUnresolvedDecisionForRuntime,
  joinRuntimeProjectionLines,
} from "./format-projection.js";

const ISO = "2026-05-26T12:00:00.000Z";
const ISO_EXPIRED = "2026-05-25T12:00:00.000Z";

const OPEN_DECISION = {
  id: "dec-1",
  question: "Which storage backend?",
  status: "open" as const,
  scope: "project" as const,
  options: [
    {
      id: "opt-1",
      label: "SQLite",
      tradeoffs: ["local only"],
      evidence_refs: ["evidence-1"],
    },
    {
      id: "opt-2",
      label: "Postgres",
      tradeoffs: ["hosted"],
      evidence_refs: ["evidence-2"],
    },
  ],
  urgency: "medium" as const,
  owner: "user" as const,
  created_at: ISO,
  last_touched_at: ISO,
  provenance: ["signal-1"],
};

const DECIDED_DECISION = {
  ...OPEN_DECISION,
  status: "decided" as const,
  selected_option_id: "opt-1",
};

const CURRENT_LEANING = {
  decision_id: "dec-1",
  option_id: "opt-1",
  observed_at: ISO,
  source_signal_id: "signal-lean-1",
  freshness: "fresh" as const,
};

const STALE_LEANING = {
  ...CURRENT_LEANING,
  freshness: "stale" as const,
};

const ACTIVE_TIME_BOUNDED_PREFERENCE = {
  id: "pref-1",
  statement: "Keep responses short today",
  mode: "time_bounded" as const,
  scope: "user" as const,
  context: {},
  status: "active" as const,
  expires_at: ISO,
  first_observed_at: ISO,
  last_observed_at: ISO,
  source_signal_ids: ["signal-3"],
  confidence: "medium" as const,
  promotion_evidence: {
    repetition_count: 0,
    independent_sessions: 0,
  },
};

const TENTATIVE_PREFERENCE = {
  ...ACTIVE_TIME_BOUNDED_PREFERENCE,
  id: "pref-2",
  statement: "Prefer bullet lists for now",
  mode: "tentative" as const,
  expires_at: undefined,
};

const EXPIRED_PREFERENCE = {
  ...ACTIVE_TIME_BOUNDED_PREFERENCE,
  id: "pref-3",
  status: "expired" as const,
  expires_at: ISO_EXPIRED,
};

const ACTIVE_CRYSTAL = {
  id: "hyp-1",
  claim: "Cursor works best for refactors in this repo",
  status: "active" as const,
  scope: "project" as const,
  project_ref: "ai-memory",
  related_goal_ids: [],
  related_decision_ids: [],
  supporting_evidence_refs: ["evidence-a", "evidence-b"],
  contradicting_evidence_refs: ["evidence-c"],
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

const HARNESS_STATE = {
  id: "harness-1",
  harness: "cursor",
  instance_id: "inst-99",
  project_ref: "ai-memory",
  session_id: "session-1",
  status: "active" as const,
  cwd: "/Users/dev/Dev/Github/ai-memory",
  branch: "ralph/amp-runtime-04-projection-formatters",
  active_files: ["src/amp/runtime-semantics/format-projection.ts"],
  loaded_context_refs: ["ctx-1", "ctx-2"],
  configured_capabilities: ["edit", "terminal"],
  blockers: ["Waiting on schema review"],
  last_successful_action: "npm run typecheck",
  last_failed_action: "npm test",
  next_agent_instruction: "Finish projection formatters",
  observed_at: ISO,
  expires_at: ISO,
  source_signal_ids: ["signal-4", "signal-5"],
};

const CLOSED_HARNESS_STATE = {
  ...HARNESS_STATE,
  status: "closed" as const,
};

const REJECTED_SIGNAL = {
  rejected_signal_id: "rej-1",
  timestamp: ISO,
  reason_code: "telemetry_without_semantic_content",
  source_surface: "cursor",
  scope: "project" as const,
  redacted_excerpt: "token=secret-value-should-not-leak",
  source_hash: "sha256:abc123",
};

const ACTIVE_EPISODIC_FRAME = {
  id: "frame-1",
  event_type: "correction" as const,
  summary: "User corrected the storage approach",
  details: { backend: "sqlite" },
  tags: ["storage"],
  scope: "user" as const,
  curation_mode: "personal" as const,
  occurred_at: ISO,
  recorded_at: ISO,
  source_signals: ["signal-5"],
  related_entities: {},
  evidence_refs: ["evidence-1"],
  provenance: {
    transform_id: "frame-v1",
  },
  confidence: "high" as const,
  source: "user_explicit" as const,
  sensitivity: "normal" as const,
  visibility: "user_private" as const,
  pinned: false,
  lifecycle_state: "active" as const,
};

function textOf(formatted: { lines: string[] } | null): string {
  return formatted ? joinRuntimeProjectionLines(formatted.lines) : "";
}

describe("formatUnresolvedDecisionForRuntime", () => {
  it("renders open decisions as pending/undecided, never as final truth", () => {
    const formatted = formatUnresolvedDecisionForRuntime(OPEN_DECISION);
    assert.ok(formatted);
    const text = textOf(formatted);
    assert.match(text, /Pending decision/i);
    assert.match(text, /Undecided/i);
    assert.match(text, /Which storage backend\?/);
    assert.match(text, /SQLite/);
    assert.match(text, /Postgres/);
    assert.doesNotMatch(text, /Selected:/i);
    assert.doesNotMatch(text, /Final decision/i);
    assert.equal(formatted!.activeInstruction, false);
  });

  it("renders decided status with explicit final selection only when status is decided", () => {
    const formatted = formatUnresolvedDecisionForRuntime(DECIDED_DECISION);
    assert.ok(formatted);
    const text = textOf(formatted);
    assert.match(text, /Decided/i);
    assert.match(text, /Selected: SQLite/);
  });

  it("labels current leaning as transient and not decided", () => {
    const formatted = formatUnresolvedDecisionForRuntime(OPEN_DECISION, {
      currentLeaning: CURRENT_LEANING,
    });
    assert.ok(formatted);
    const text = textOf(formatted);
    assert.match(text, /Current leaning, not decided/i);
    assert.match(text, /signal-lean-1/);
    assert.ok(text.includes(ISO));
    assert.doesNotMatch(text, /Final decision/i);
  });

  it("omits stale leaning by default", () => {
    const formatted = formatUnresolvedDecisionForRuntime(OPEN_DECISION, {
      currentLeaning: STALE_LEANING,
    });
    assert.ok(formatted);
    assert.doesNotMatch(textOf(formatted), /Current leaning/i);
  });

  it("includes stale leaning when explicitly requested", () => {
    const formatted = formatUnresolvedDecisionForRuntime(OPEN_DECISION, {
      currentLeaning: STALE_LEANING,
      includeStaleLeaning: true,
    });
    assert.ok(formatted);
    const text = textOf(formatted);
    assert.match(text, /Current leaning, not decided/i);
    assert.match(text, /stale/i);
  });

  it("includes project scope in formatting when helpful", () => {
    const formatted = formatUnresolvedDecisionForRuntime(OPEN_DECISION);
    assert.ok(formatted);
    assert.match(textOf(formatted), /Scope: project/);
  });

  it("returns null for abandoned decisions", () => {
    const formatted = formatUnresolvedDecisionForRuntime({
      ...OPEN_DECISION,
      status: "abandoned",
    });
    assert.equal(formatted, null);
  });

  it("warns when decided status lacks selected_option_id", () => {
    const formatted = formatUnresolvedDecisionForRuntime({
      ...OPEN_DECISION,
      status: "decided",
    });
    assert.ok(formatted);
    const text = textOf(formatted);
    assert.match(text, /incomplete/i);
    assert.match(text, /selected_option_id missing/i);
    assert.doesNotMatch(text, /Options:/);
    assert.equal(formatted!.activeInstruction, false);
  });
});

describe("formatRuntimePreferenceCandidateForRuntime", () => {
  it("renders time-bounded preferences with expires_at", () => {
    const formatted = formatRuntimePreferenceCandidateForRuntime(
      ACTIVE_TIME_BOUNDED_PREFERENCE,
    );
    assert.ok(formatted);
    const text = textOf(formatted);
    assert.match(text, /expires_at:/i);
    assert.ok(text.includes(ISO));
    assert.match(text, /confidence: medium/);
    assert.equal(formatted!.activeInstruction, true);
  });

  it("renders tentative preferences as not durable", () => {
    const formatted = formatRuntimePreferenceCandidateForRuntime(TENTATIVE_PREFERENCE);
    assert.ok(formatted);
    const text = textOf(formatted);
    assert.match(text, /Tentative preference/i);
    assert.match(text, /not durable/i);
    assert.equal(formatted!.activeInstruction, true);
  });

  it("marks expired preferences inactive instead of active instructions", () => {
    const formatted = formatRuntimePreferenceCandidateForRuntime(EXPIRED_PREFERENCE);
    assert.ok(formatted);
    assert.match(textOf(formatted), /inactive|expired/i);
    assert.equal(formatted!.activeInstruction, false);
  });

  it("omits expired preferences when omitInactive is set", () => {
    const formatted = formatRuntimePreferenceCandidateForRuntime(EXPIRED_PREFERENCE, {
      omitInactive: true,
    });
    assert.equal(formatted, null);
  });

  it("omits promoted preferences from active runtime instructions", () => {
    const formatted = formatRuntimePreferenceCandidateForRuntime({
      ...ACTIVE_TIME_BOUNDED_PREFERENCE,
      status: "promoted",
    });
    assert.equal(formatted, null);
  });

  it("marks contradicted preferences inactive", () => {
    const formatted = formatRuntimePreferenceCandidateForRuntime({
      ...ACTIVE_TIME_BOUNDED_PREFERENCE,
      status: "contradicted",
    });
    assert.ok(formatted);
    assert.match(textOf(formatted), /inactive \(contradicted\)/);
    assert.equal(formatted!.activeInstruction, false);
  });
});

describe("formatRuntimeCrystalCandidateForRuntime", () => {
  it("renders active hypotheses as working/provisional with evidence counts", () => {
    const formatted = formatRuntimeCrystalCandidateForRuntime(ACTIVE_CRYSTAL);
    assert.ok(formatted);
    const text = textOf(formatted);
    assert.match(text, /Working hypothesis/i);
    assert.match(text, /provisional/i);
    assert.match(text, /supporting evidence: 2/i);
    assert.match(text, /contradicting evidence: 1/i);
    assert.match(text, /confidence: low/);
    assert.equal(formatted!.activeInstruction, true);
  });

  it("does not render promoted crystals as runtime facts", () => {
    const formatted = formatRuntimeCrystalCandidateForRuntime({
      ...ACTIVE_CRYSTAL,
      status: "promoted",
    });
    assert.equal(formatted, null);
  });

  it("marks refuted hypotheses inactive", () => {
    const formatted = formatRuntimeCrystalCandidateForRuntime({
      ...ACTIVE_CRYSTAL,
      status: "refuted",
    });
    assert.ok(formatted);
    assert.match(textOf(formatted), /refuted/i);
    assert.equal(formatted!.activeInstruction, false);
  });

  it("marks stale hypotheses inactive", () => {
    const formatted = formatRuntimeCrystalCandidateForRuntime({
      ...ACTIVE_CRYSTAL,
      status: "stale",
    });
    assert.ok(formatted);
    assert.match(textOf(formatted), /stale/i);
    assert.equal(formatted!.activeInstruction, false);
  });

  it("treats supported hypotheses as active instructions", () => {
    const formatted = formatRuntimeCrystalCandidateForRuntime({
      ...ACTIVE_CRYSTAL,
      status: "supported",
    });
    assert.ok(formatted);
    assert.match(textOf(formatted), /status: supported/);
    assert.equal(formatted!.activeInstruction, true);
  });
});

describe("formatHarnessOperationalStateForRuntime", () => {
  it("renders actionable operational state and excludes telemetry-like fields", () => {
    const formatted = formatHarnessOperationalStateForRuntime(HARNESS_STATE);
    assert.ok(formatted);
    const text = textOf(formatted);
    assert.match(text, /cursor/);
    assert.match(text, /Waiting on schema review/);
    assert.match(text, /Finish projection formatters/);
    assert.match(text, /Scope: project \(ai-memory\)/);
    assert.doesNotMatch(text, /inst-99/);
    assert.doesNotMatch(text, /signal-4/);
    assert.doesNotMatch(text, /ctx-1/);
    assert.doesNotMatch(text, /observed_at/i);
    assert.equal(formatted!.activeInstruction, true);
  });

  it("does not render closed harness state as active by default", () => {
    const formatted = formatHarnessOperationalStateForRuntime(CLOSED_HARNESS_STATE);
    assert.equal(formatted, null);
  });

  it("renders closed harness as inactive when explicitly requested", () => {
    const formatted = formatHarnessOperationalStateForRuntime(CLOSED_HARNESS_STATE, {
      includeClosed: true,
    });
    assert.ok(formatted);
    assert.match(textOf(formatted), /closed \(inactive\)/i);
    assert.equal(formatted!.activeInstruction, false);
  });

  it("treats degraded harness state as an active instruction", () => {
    const formatted = formatHarnessOperationalStateForRuntime({
      ...HARNESS_STATE,
      status: "degraded",
    });
    assert.ok(formatted);
    assert.match(textOf(formatted), /Status: degraded/);
    assert.equal(formatted!.activeInstruction, true);
  });

  it("treats unavailable harness state as inactive", () => {
    const formatted = formatHarnessOperationalStateForRuntime({
      ...HARNESS_STATE,
      status: "unavailable",
    });
    assert.ok(formatted);
    assert.match(textOf(formatted), /Status: unavailable/);
    assert.equal(formatted!.activeInstruction, false);
  });
});

describe("formatEpisodicFrameForRuntime", () => {
  it("renders active frames with summary and lineage", () => {
    const formatted = formatEpisodicFrameForRuntime(ACTIVE_EPISODIC_FRAME);
    assert.ok(formatted);
    const text = textOf(formatted);
    assert.match(text, /User corrected the storage approach/);
    assert.match(text, /Lineage/i);
    assert.match(text, /frame-v1/);
    assert.match(text, /Scope: user/);
    assert.match(text, /confidence: high/);
    assert.match(text, /source: user_explicit/);
  });

  it("does not render content for deleted frames", () => {
    const formatted = formatEpisodicFrameForRuntime({
      ...ACTIVE_EPISODIC_FRAME,
      lifecycle_state: "deleted",
      deleted_at: ISO,
      deleted_reason: "operator forget",
    });
    assert.equal(formatted, null);
  });

  it("renders dormant frames as metadata only when explicitly requested", () => {
    const withoutMetadata = formatEpisodicFrameForRuntime({
      ...ACTIVE_EPISODIC_FRAME,
      lifecycle_state: "dormant",
      dormant_snapshot_id: "snap-1",
    });
    assert.equal(withoutMetadata, null);

    const withMetadata = formatEpisodicFrameForRuntime(
      {
        ...ACTIVE_EPISODIC_FRAME,
        lifecycle_state: "deep_dormant",
        dormant_snapshot_id: "snap-2",
      },
      { includeDormantMetadata: true },
    );
    assert.ok(withMetadata);
    const text = textOf(withMetadata);
    assert.match(text, /dormant metadata/i);
    assert.match(text, /snap-2/);
    assert.doesNotMatch(text, /User corrected the storage approach/);
  });

  it("does not render summary or details for secret_redacted frames", () => {
    const formatted = formatEpisodicFrameForRuntime({
      ...ACTIVE_EPISODIC_FRAME,
      sensitivity: "secret_redacted",
      summary: "Contains secret-token in summary",
      details: { token: "secret-token" },
    });
    assert.ok(formatted);
    const text = textOf(formatted);
    assert.match(text, /secret_redacted/i);
    assert.match(text, /metadata only/i);
    assert.doesNotMatch(text, /secret-token/);
    assert.doesNotMatch(text, /Contains secret-token in summary/);
  });

  it("renders sensitive frames as metadata-only by default", () => {
    const formatted = formatEpisodicFrameForRuntime({
      ...ACTIVE_EPISODIC_FRAME,
      sensitivity: "sensitive",
      summary: "Sensitive summary must not leak",
      details: { note: "sensitive-detail" },
    });
    assert.ok(formatted);
    const text = textOf(formatted);
    assert.match(text, /metadata only/i);
    assert.doesNotMatch(text, /Sensitive summary must not leak/);
    assert.doesNotMatch(text, /sensitive-detail/);
  });

  it("renders sensitive summary when includeSensitive is true", () => {
    const formatted = formatEpisodicFrameForRuntime(
      {
        ...ACTIVE_EPISODIC_FRAME,
        sensitivity: "sensitive",
        summary: "Sensitive summary with opt-in",
        details: { note: "still-hidden-detail" },
      },
      { includeSensitive: true },
    );
    assert.ok(formatted);
    const text = textOf(formatted);
    assert.match(text, /Sensitive summary with opt-in/);
    assert.match(text, /details omitted/i);
    assert.doesNotMatch(text, /still-hidden-detail/);
  });
});

describe("formatRejectedSignalLogForRuntime", () => {
  it("formats audit metadata only and never exposes raw content", () => {
    const formatted = formatRejectedSignalLogForRuntime(REJECTED_SIGNAL);
    assert.ok(formatted);
    const text = textOf(formatted);
    assert.match(text, /rej-1/);
    assert.match(text, /telemetry_without_semantic_content/);
    assert.match(text, /sha256:abc123/);
    assert.match(text, /Scope: project/);
    assert.doesNotMatch(text, /secret-value-should-not-leak/);
    assert.doesNotMatch(text, /redacted_excerpt/i);
    assert.equal(formatted!.activeInstruction, false);
  });
});

describe("runtime projection formatting determinism", () => {
  it("returns identical lines for identical input", () => {
    const first = formatRuntimeCrystalCandidateForRuntime(ACTIVE_CRYSTAL);
    const second = formatRuntimeCrystalCandidateForRuntime(ACTIVE_CRYSTAL);
    assert.deepEqual(first, second);
  });
});
