/**
 * Shared runtime semantics test fixtures — test-only; not imported by production code.
 */

import type { RuntimeSemanticEntityRecord } from "./entity-record.js";
import type {
  CurrentDecisionLeaning,
  DormantSnapshot,
  EpisodicFrame,
  RejectedSignalLog,
  RuntimePreferenceCandidate,
  UnresolvedDecision,
} from "./schema.js";

export const FIXTURE_ISO = "2026-05-26T12:00:00.000Z";
export const FIXTURE_PROJECT_REF = "ai-memory";

export const ACTIVE_PREFERENCE: RuntimePreferenceCandidate = {
  id: "pref-1",
  statement: "Keep responses short today",
  mode: "time_bounded",
  scope: "user",
  context: {},
  status: "active",
  expires_at: FIXTURE_ISO,
  first_observed_at: FIXTURE_ISO,
  last_observed_at: FIXTURE_ISO,
  source_signal_ids: ["signal-3"],
  confidence: "medium",
  promotion_evidence: {
    repetition_count: 0,
    independent_sessions: 0,
  },
};

export const VALID_ACTIVE_PREFERENCE_RECORD: RuntimeSemanticEntityRecord = {
  id: "pref-1",
  kind: "runtime-preference-candidate",
  scope: "user",
  payload: ACTIVE_PREFERENCE,
};

export const TRACEABLE_EPISODIC_FRAME: EpisodicFrame = {
  id: "episodic-facade",
  event_type: "session_event",
  summary: "Facade generic episodic write",
  details: {
    source_surface: "test",
  },
  tags: [],
  scope: "user",
  curation_mode: "personal",
  occurred_at: FIXTURE_ISO,
  recorded_at: FIXTURE_ISO,
  source_signals: ["signal-facade-1"],
  related_entities: {},
  evidence_refs: [],
  provenance: {
    transform_id: "test.generic-episodic.v1",
  },
  confidence: "medium",
  source: "agent_inferred",
  sensitivity: "normal",
  visibility: "user_private",
  pinned: false,
  lifecycle_state: "active",
};

export const CORRECTION_EPISODIC_FRAME: EpisodicFrame = {
  id: "frame-1",
  event_type: "correction",
  summary: "User corrected the storage approach",
  details: { backend: "sqlite" },
  tags: ["storage"],
  scope: "user",
  curation_mode: "personal",
  occurred_at: FIXTURE_ISO,
  recorded_at: FIXTURE_ISO,
  source_signals: ["signal-5"],
  related_entities: {},
  evidence_refs: ["evidence-1"],
  provenance: {
    transform_id: "frame-v1",
  },
  confidence: "high",
  source: "user_explicit",
  sensitivity: "normal",
  visibility: "user_private",
  pinned: false,
  lifecycle_state: "active",
};

export const OPEN_DECISION: UnresolvedDecision = {
  id: "dec-1",
  question: "Which storage backend?",
  status: "open",
  scope: "project",
  options: [
    {
      id: "opt-1",
      label: "SQLite",
      tradeoffs: ["local only"],
      evidence_refs: ["evidence-1"],
    },
  ],
  urgency: "medium",
  owner: "user",
  created_at: FIXTURE_ISO,
  last_touched_at: FIXTURE_ISO,
  provenance: ["signal-1"],
};

export const CURRENT_DECISION_LEANING: CurrentDecisionLeaning = {
  decision_id: "dec-1",
  option_id: "opt-1",
  observed_at: FIXTURE_ISO,
  source_signal_id: "signal-lean-1",
  freshness: "fresh",
};

export const REJECTED_SIGNAL: RejectedSignalLog = {
  rejected_signal_id: "rej-1",
  timestamp: FIXTURE_ISO,
  reason_code: "telemetry_without_semantic_content",
  source_surface: "cursor",
  scope: "project",
  redacted_excerpt: "token=secret-value-should-not-leak",
  source_hash: "sha256:abc123",
};

export const DORMANT_SNAPSHOT: DormantSnapshot = {
  frame_id: "frame-1",
  snapshot_version: 1,
  event_type: "correction",
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
  occurred_at: FIXTURE_ISO,
  dormancy_entered_at: FIXTURE_ISO,
  embedding: [0.1, 0.2],
  source: "user_explicit",
  confidence_at_dormancy: "high",
  activation_history: {
    times_activated: 0,
  },
  generated_by: {
    transform_id: "dormant-snapshot-v1",
    cache_key: "sha256:snapshot-key",
  },
};
