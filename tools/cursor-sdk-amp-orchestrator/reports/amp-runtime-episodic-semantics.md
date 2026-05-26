# AMP Runtime / Episodic Memory Semantics Plan

> **Status:** working draft v3 — ontology locked through Q10; implementation planning ready
> **Branch:** `ralph/amp-runtime-semantics-plan`
> **Mode:** planning / spec / report only — no implementation
> **Source:** operator interview, May 2026
> **Companions:** `docs/specs/AMP_CONSOLIDATED_SPEC.md`, `AMP_SPEC_UPDATE_TWO_FILE_MODEL.md`

## Purpose

Define what AMP runtime memory and episodic memory contain, what each is for,
how they differ from durable knowledge, and how they project into agent
context. This report locks ontology-level decisions before table schemas,
storage engines, or projection rewrites are implemented.

## Adjacent Research Findings

### CocoIndex

CocoIndex (`cocoindex-io/cocoindex`) is a real-time data transformation
framework, not a primary AMP database. Its useful design pressure for AMP is
the source -> transformation -> target model: projection files should remain
derived target state, while the runtime/knowledge stores remain source of
truth.

**Claims and labels**

| Claim | Label |
|---|---|
| CocoIndex is relevant as a declarative / incremental transformation model | PROVISIONAL |
| CocoIndex should become an AMP dependency in v1.5 | UNKNOWN / not decided |
| CocoIndex may be useful for future consolidation/materialized-view execution | PROVISIONAL |

### SkillOpt / Agent Skills Benchmarking

The operator-provided SkillOpt notes and the `Agent-Skills-for-Context-Engineering`
v2.3.0 release point at the same structural lesson: skills are trainable,
measurable artifacts; short high-signal bodies beat long undifferentiated
context; router/activation benchmarks matter.

**Claims and labels**

| Claim | Label |
|---|---|
| Agent-Skills-for-Context-Engineering v2.3.0 reports measured router and effectiveness benchmark results | VERIFIED |
| SkillOpt protected-section and validation-gate details as described in operator notes | PROVISIONAL until paper/source spike is committed |
| AMP should borrow protected-section discipline for procedural artifacts | PROVISIONAL design decision, locked for v1.5 planning |

## Topic 0 — Runtime vs Episodic Boundary

**Locked decision:** Runtime is a two-compartment working-memory layer.
Episodic is also a durable frame kind in the knowledge store.

### Runtime Layer

Runtime has two compartments:

- **Attention buffer:** current active intent, in-flight task state, and last-N
  signals being held for potential consolidation. Mutable, fast decay, read on
  session start.
- **Episodic buffer:** integrated recent events not yet consolidated.
  Supersede-only, persists across sessions, drained by consolidation into
  durable episodic frames.

### Durable Episodic Memory

Durable episodic memory lives in the knowledge store as one of AMP's frame
kinds: `episodic`, `semantic`, and `crystal`. Durable episodic frames are
append-only, immutable, scope-aware, and trace back to originating signals.

### Falsifiable Test

Within a session, attention entries can be overwritten by newer superseding
signals. Episodic-buffer entries cannot be overwritten, only superseded with
lineage. Durable episodic frames cannot be modified once written, only
superseded by newer frames.

### Assumption A1

The episodic buffer bridges within-session and cross-session continuity. Test:
if a non-trivial correction happens at minute 5, then the session continues for
60 minutes, ends, and restarts 12 hours later, the new session should reflect
the correction without manual restatement.

## Topic 0.5 — Determinism Principle

Every AMP transformation produces reproducible output given the same input,
including LLM-assisted transformations.

Required properties:

- deterministic given input
- LLM caching by content key
- explicit re-runnability via future `amp reclassify <id>`
- lineage tracking
- replayability

Canonical cache key shape:

```text
sha256({
  input: normalized signal payload,
  model: model id + version,
  prompt: prompt template id + version,
  purpose: classification purpose
})
```

## Topic 1.A — Goal Entity

Goals live across attention, episodic buffer, and durable episodic frames.

```text
Goal {
  id
  description
  status: open | succeeded | failed | abandoned
  parent_goal_id?
  abstraction_level: 1..5
  expected_horizon: minutes | hours | days | weeks | months
  embedding
  observed_signals: {
    project_paths
    branches
    primary_files
    primary_harnesses
  }
  created_at
  created_in_session
  source: user_explicit | agent_inferred
}
```

Locked decisions:

- hierarchy is preferred but not enforced
- orphan goals are allowed
- goal declaration is hybrid: user-explicit or agent-inferred via proposal queue
- status transitions require explicit signals

## Topic 1.B — Session Entity

Sessions are task-bound. Lifetime equals goal lifetime. Multiple harness
instances can attach over the lifespan.

```text
Session {
  id
  active_goal_id
  status: active | paused | ended
  started_at
  last_seen_at
  harness_instances
  current_focus
  in_flight_tool_attempt_id?
  pending_steps
}
```

Attachment uses multi-signal scoring:

- semantic similarity
- path match
- branch match
- file overlap
- recency
- harness history

Assumption A4: this scoring attaches sessions to goals correctly at least 90%
of the time after enough historical data exists.

## Topic 1.C — Recent Corrections

Corrections have three life stages:

- **Firehose:** every raw correction captured into episodic buffer
- **Pending:** surfaced in runtime projection until consolidated
- **Durable:** consolidated into episodic / semantic frames and no longer
  surfaced as pending runtime

Corrections are scope-filtered:

- project-scoped -> project `runtime.md`
- cross-project / user-level -> global `runtime.md`

Every pending correction carries signal id, session id, timestamp, and lineage.

## Topic 1.D — Unresolved Decisions

Unresolved decisions are first-class runtime entities, not goals with a flag.

A goal is something the user is trying to accomplish. An unresolved decision is
a pending choice that may block, shape, or constrain a goal. Decisions need
native structure: options, tradeoffs, evidence, rejected options, due metadata,
and final selected option.

```text
UnresolvedDecision {
  id
  question
  status: open | decided | abandoned
  blocking_goal_id?
  scope: project | user | universal
  options: list<{
    id
    label
    tradeoffs
    evidence_refs
    rejected?
    rejection_reason?
  }>
  selected_option_id?
  urgency: low | medium | high
  owner: user | agent | shared
  decision_due?
  created_at
  last_touched_at
  provenance: signal_ids[]
}
```

`current_leaning` is not durable state on the decision. It lives in the
attention buffer only and must carry freshness and lineage:

```text
CurrentDecisionLeaning {
  decision_id
  option_id
  observed_at
  source_signal_id
  freshness: fresh | stale
}
```

Runtime projection keeps both active blockers and recent open loops:

- active blocking decisions are always preserved while blocking the active goal
- recent non-blocking open loops are capped, decay quickly, and drop before
  active intent, recent corrections, or active blockers

`decision_due` is metadata only. It affects ordering and urgency display, but
does not auto-transition state.

Projection rule: unresolved decisions must never be rendered as durable facts.
They render only as pending choices with status, options, freshness, and
lineage.

## Topic 1.E — Temporary Preferences

Temporary preferences are runtime-scoped preference candidates. They may affect
agent behavior while active, but they do not become durable semantic
preferences unless explicitly confirmed or repeatedly observed.

Two cases are truly temporary:

- **time-bounded preference:** has explicit expiry
- **tentative preference:** not stable truth yet

Context-boundedness is not itself temporary. It is a scope/context constraint
that can attach to either temporary or durable preferences.

```text
RuntimePreferenceCandidate {
  id
  statement
  mode: time_bounded | tentative
  scope: project | user | universal
  project_ref?
  context: {
    goal_id?
    session_id?
    branch?
    file_globs?
    task_label?
  }
  status: active | expired | contradicted | promoted | abandoned
  expires_at?
  first_observed_at
  last_observed_at
  source_signal_ids
  confidence: low | medium | high
  promotion_evidence: {
    explicit_confirmation_signal_id?
    repetition_count
    independent_sessions
    no_contradiction_days?
  }
}
```

Promotion requires explicit user confirmation or repeated independent
observations. No-contradiction over time may increase confidence, but is never
sufficient by itself.

Default repeated-observation threshold:

- at least 3 compatible signals
- across at least 2 sessions
- same scope/context
- no direct contradiction

## Topic 1.F — Working Hypotheses

Working hypotheses are `RuntimeCrystalCandidate`s: pre-durable crystal claims
held in runtime while they are being investigated.

```text
RuntimeCrystalCandidate {
  id
  claim
  status: active | supported | refuted | stale | promoted | abandoned
  scope: project | user | universal
  project_ref?
  related_goal_ids
  related_decision_ids
  supporting_evidence_refs
  contradicting_evidence_refs
  predicted_observations
  successful_predictions
  failed_predictions
  confidence: low | medium | high
  contradiction_score: low | medium | high
  pinned
  first_observed_at
  last_referenced_at
  last_tested_at?
  source_signal_ids
  lineage: {
    generated_by: user | agent | tool
    transform_id?
    prompt_version?
    model_version?
  }
}
```

Hypotheses decay aggressively compared with goals and decisions. Primary decay
is signal-based: not referenced, not tested, not tied to active goals, not
pinned, and no evidence changes. Secondary decay is time-assisted. Strong
contradicting evidence may immediately mark a hypothesis refuted.

Promotion to durable crystal requires:

- support above threshold
- unresolved contradiction below threshold
- at least one successful prediction or action guided by the hypothesis
- complete lineage

## Topic 1.G — Tool / Harness State

AMP captures operational state only: tool or harness facts that change what the
next agent should do. Raw telemetry is not runtime memory.

```text
HarnessOperationalState {
  id
  harness
  instance_id?
  project_ref?
  session_id?
  status: active | degraded | unavailable | closed
  cwd?
  branch?
  active_files?
  loaded_context_refs?
  configured_capabilities?
  blockers?
  last_successful_action?
  last_failed_action?
  next_agent_instruction?
  observed_at
  expires_at?
  source_signal_ids
}
```

Attention holds active operational state. Episodic buffer records harness
open/close, failure, recovery, and capability-change events. Durable episodic
frames store harness summaries after close. Repeated operational evidence may
later consolidate into crystal tool-fit knowledge.

Telemetry such as invocation counts, average command durations, or token usage
routes to ops logging or nowhere. It becomes AMP memory only if interpreted
into a semantic claim, working hypothesis, or tool-fit pattern with lineage.

## Topic 1.H — Emotional / Communication Context

AMP never captures inferred emotional state.

Allowed:

- explicit user statements about current state when operationally relevant
- communication preferences stated by the user
- time-bounded instructions such as "I'm tired, keep it short"

These are modeled as `RuntimePreferenceCandidate`s or runtime notes, not
inferred emotion records.

Rejected:

- inferred frustration
- inferred mood
- inferred personality claims
- agent-written emotional readings

Explicit current-state statements are time-bounded by default and do not become
durable semantic memory without explicit confirmation.

## Topic 1.I — Runtime Exclusion List

AMP rejects the following from runtime capture:

1. PII not relevant to work
2. credentials, secrets, tokens
3. inferred emotional state
4. telemetry or metrics without semantic content
5. verbatim long transcripts or bulky content
6. long third-party quoted content
7. content that would violate AMP-managed local-only/gitignore rules
8. speculative identity/personality claims not explicitly stated by the user
9. legal, medical, or financial conclusions not explicitly provided and
   task-relevant
10. third-party confidential/private information not necessary for the active
    task

Do not reject public or task-relevant third-party identifiers such as paper
authors, advisor names, institutional affiliations, collaborators, public
roles, or cited researchers.

Rejected signals are not silently dropped. AMP records an audit entry with
reason, source, timestamp, and source hash. The rejected-signals log must not
store raw secrets or raw sensitive content.

```text
RejectedSignalLog {
  rejected_signal_id
  timestamp
  reason_code
  source_surface
  scope
  redacted_excerpt?
  source_hash
}
```

## Question 2 — Episodic Frame Schema and Retention

This section describes durable episodic frames in the knowledge store, not the
runtime episodic buffer.

`event_type` is a fixed enum, not an open string. AMP is a multi-consumer
substrate serving Claude Code, Cursor, Codex, gbrain, Hermes, OpenClaw, and
future tools. Stable event types are required for predictable queries,
indexing, projections, and cross-tool interpretation. Extensibility belongs in
`tags` and `attributes`, not `event_type`.

```text
EpisodicFrame {
  id
  event_type:
    signal_observed
    | goal_event
    | decision_event
    | correction
    | hypothesis_event
    | preference_event
    | tool_attempt
    | session_event
    | projection_event
    | rejection_event

  summary
  details?
  tags
  attributes?

  scope: project | user | universal
  project_ref?
  curation_mode: personal | llm_curated | shared

  occurred_at
  recorded_at

  source_signals
  related_entities: {
    goal_ids?
    decision_ids?
    preference_ids?
    hypothesis_ids?
    session_ids?
    tool_attempt_ids?
  }

  evidence_refs
  provenance: {
    transform_id?
    prompt_version?
    model_version?
    cache_key?
  }

  confidence: low | medium | high
  source: user_explicit | agent_inferred | tool_observed
  sensitivity: normal | sensitive | secret_redacted
  visibility: project_only | user_private | shared_candidate

  pinned
  lifecycle_state: active | dormant | deep_dormant | deleted
  dormant_snapshot_id?
  access_stats?: {
    last_accessed_at?
    access_count?
  }

  embedding?

  superseded_by?
  deleted_at?
  deleted_reason?
  deletion_verified_at?
}
```

Retention is forever-by-default. Durable episodic frames are append-only and
immutable. AMP does not delete durable episodic frames due to age, low access
frequency, or adaptive decay. Adaptive relevance may affect projection ranking
and retrieval ordering, but not source retention.

Normal `amp forget <id>` hides content from retrieval/projection and preserves a
tombstone, source hash, deletion reason, and lineage. Secret/privacy purge may
physically redact sensitive payload while preserving only a minimal hash stub
and audit metadata. Post-deletion verification is required.

### Dormancy and Snapshot Retrieval

Forever-by-default retention does not mean every frame remains in active
retrieval forever.

AMP uses retrieval lifecycle state:

- `active` — full frame participates in default retrieval
- `dormant` — full frame retained, snapshot participates in dormant retrieval
- `deep_dormant` — full frame retained, snapshot only scanned by explicit deep
  recall
- `deleted` — content hidden/redacted; lineage stub retained

Dormant snapshots are retrieval beacons, not summaries of truth. They are
small, cue-rich records generated when a frame enters dormancy.

```text
DormantSnapshot {
  frame_id
  snapshot_version
  event_type
  summary_compressed
  key_terms
  encoding_context: {
    project_ref?
    goal_ids
    session_ids
    task_label?
    abstraction_level?
    expected_horizon?
  }
  related_entities_compressed: {
    goal_ids
    decision_ids
    hypothesis_ids
  }
  occurred_at
  dormancy_entered_at
  embedding
  source
  confidence_at_dormancy
  activation_history: {
    times_activated
    last_activated_at?
  }
  generated_by: {
    transform_id
    prompt_version?
    model_version?
    cache_key
  }
}
```

Snapshot generation is deterministic and cached. Snapshots are generated at
active -> dormant transition and are immutable except through explicit
`amp resnapshot <id>` or reviewed bulk resnapshot operations. No silent
resnapshotting.

Activation is bounded by top-K and projection budget. Activating a dormant
frame records a `SurfacingEvent`; repeated valuable surfacing can promote the
frame back toward active retrieval.

## Question 3 — Runtime Memory Purpose

Runtime memory exists for:

1. immediate session continuity
2. cross-agent / cross-tool handoff
3. avoiding repeated questions
4. preserving current intent before durable consolidation
5. preventing premature durable truth
6. transparency / corrigibility: user can inspect and correct current AMP state

## Question 4 — Sharing Rules

Capture filtering and projection routing are separate lifecycle stages.

### Capture Filter

Rejected-at-capture content follows Topic 1.I and writes only a redacted
`RejectedSignalLog` entry.

### Projection Routing

| Item | Global runtime.md | Project runtime.md | Never projected |
|---|---|---|---|
| Stable identity | no, belongs in global projection.md | no | no |
| Pending identity/profile changes | yes | no | no |
| Active intent (cross-tool) | yes | no | no |
| Active intent (project) | no | yes | no |
| Active goal | yes if cross-project | yes if project-scoped | no |
| Active blocking decisions | yes if user-scope | yes if project-scope | no |
| Recent open-loop decisions | capped, fast decay | capped, fast decay | no |
| Pending corrections | yes if user-scope | yes if project-scope | no |
| Tentative preferences | yes if user-scope | yes if project-scope | no |
| Active hypotheses | yes if cross-project | yes if project-scope | no |
| HarnessOperationalState | yes if global/cross-tool | yes if project-specific | stale/non-actionable |
| RejectedSignalLog | no | no | yes by default |
| Stale hypotheses | no | no | yes |
| Expired preferences | no | no | yes |
| Inferred emotional state | no | no | yes, never captured |
| Telemetry | no | no | yes, never captured |
| Credentials | no | no | yes, never captured |
| Verbatim long content | no | no | yes, never captured |

Unresolved decisions must render as pending/undecided. Working hypotheses must
render as provisional. Agent-inferred entities must render with hedging and
lineage.

## Question 5 — Graduation Rules

| Runtime state | Durable target | Rule |
|---|---|---|
| RuntimePreferenceCandidate | semantic frame | explicit confirmation OR 3+ compatible signals across 2+ sessions, same scope/context, no contradiction |
| RuntimeCrystalCandidate | crystal frame | support threshold + low contradiction + successful prediction/action + complete lineage |
| UnresolvedDecision | semantic frame | status = decided + selected_option_id + source signal |
| Pending correction | episodic frame | always durable as event |
| Pending correction | semantic preference | explicit confirmation or promotion threshold |
| Stale runtime | episodic archive | superseded or decay-triggered; preserve lineage |
| Conflicting runtime | Tier 4 proposal queue | never auto-promotes; user adjudicates |

## Question 6 — Curation and Safety

Every runtime entity and durable frame carries:

- `confidence: low | medium | high`
- `source: user_explicit | agent_inferred | tool_observed`

Projection policy:

- user_explicit -> may project as stated
- tool_observed -> may project as observed fact with source
- agent_inferred -> must project with hedge and lineage

Operator review is required for:

1. project -> user/universal scope promotion
2. personal -> shared curation-mode changes
3. bulk operations (deleting/retyping many frames)
4. crystal frame promotion
5. canonical procedural artifact edits
6. physical purge of sensitive/deleted data
7. enabling live gbrain mutation, migration, or destructive cleanup
8. contradiction of already-promoted durable knowledge
9. post-deletion verification

## Implementation Roadmap

### RUNTIME-02 — Schema and Types

- Add typed runtime entity models for `UnresolvedDecision`,
  `RuntimePreferenceCandidate`, `RuntimeCrystalCandidate`,
  `HarnessOperationalState`, `RejectedSignalLog`, and `DormantSnapshot`.
- Extend episodic frame types with lifecycle, sensitivity, visibility,
  confidence/source labels, and deletion metadata.
- Add tests for schema acceptance/rejection and fixed event type enum.

### RUNTIME-03 — Runtime Inspect / Correct Commands

- Add read-only inspection command for current attention/runtime state.
- Add correction/reclassify command stubs that record explicit operator intent
  but do not silently mutate durable truth.
- Keep commands local-only and non-publishing.

### RUNTIME-04 — Projection Renderer Updates

- Render unresolved decisions as pending, never truth.
- Render temporary preferences as tentative/time-bounded.
- Render working hypotheses as provisional.
- Add budget priority: active intent, blockers, corrections, operational state,
  then capped open loops/hypotheses/preferences.

### RUNTIME-05 — Graduation and Consolidation Rules

- Implement deterministic promotion rules with cached classifications.
- Add proposal queue for conflicts and scope promotions.
- Preserve lineage from runtime entity to durable frame.

### RUNTIME-06 — Rejected Signal Filter / Audit Log

- Add capture-time filter for excluded runtime content.
- Store redacted audit entries only.
- Add tests proving secrets/raw sensitive content do not enter runtime or
  projections.

### RUNTIME-07 — Dormancy Hooks

- Add `lifecycle_state`, `pinned`, and access stats hooks.
- Do not implement full snapshot tier yet.
- Add schema tests proving lifecycle states and deleted/redacted metadata are
  representable.

### RUNTIME-08 — CocoIndex Spike

- Report-only spike on whether CocoIndex should run AMP consolidation or
  projection materialization as an incremental pipeline engine.
- Do not add dependency until local adapter behavior is verified.

### RUNTIME-09 — Live / Longitudinal Evaluation

- Define A1, A4, A6, A7, A8 measurement harnesses.
- No acceptance-gate dependency until stable and local.

## SkillOpt Integration Decisions

### Protected Sections

AMP procedural artifacts should gain protected fast/slow regions:

```html
<!-- AMP_FAST_START -->
<!-- AMP_FAST_END -->

<!-- AMP_SLOW_START -->
<!-- AMP_SLOW_END -->
```

Fast edits cannot modify slow sections. Slow edits occur only at epoch
boundaries. Both pass validation before acceptance.

### User Corrections as Verifier

Post-v1.5, AMP should use user corrections as the held-out verifier for
proposed changes:

- inference-rule updates
- skill edits
- profile-slot updates
- lookup-table updates

Acceptance should be strict improvement over baseline; ties are rejected.

### External SkillOpt

AMP may emit compatible skill artifacts for external optimization tools, then
re-ingest optimized skills as procedural updates. This remains roadmap.

## Internal Benchmarks Workstream

AMP should eventually produce internal benchmarks from its own historical data:

1. **Correction prediction:** predict future corrections from partial session
   state.
2. **Cross-session continuity:** measure whether the next session avoids user
   restatement.
3. **Tool-fit correctness:** predict which tool/harness works best for a held
   goal.

Activation threshold proposal: 60 active days, 200 captured corrections, 10
distinct goals, and at least 3 tools.

## Running Ledger of Locked Decisions

| ID | Decision |
|---|---|
| L0 | Runtime = attention buffer + episodic buffer; episodic also durable frame kind |
| L0.5 | Determinism applies to every transformation |
| L1.A.1 | Goal uses abstraction level + expected horizon |
| L1.A.2 | Goal hierarchy via `parent_goal_id`; orphans allowed |
| L1.A.3 | Goals can be explicit or inferred via proposal queue |
| L1.A.4 | Goal closure requires explicit signal |
| L1.B.1 | Session lifetime equals goal lifetime |
| L1.B.2 | Session attachment uses multi-signal scoring |
| L1.C.1 | Corrections flow firehose -> pending -> durable |
| L1.D.1 | Unresolved decisions are first-class entities |
| L1.D.2 | Current decision leaning is transient attention state only |
| L1.D.3 | Unresolved decisions project only as pending/undecided |
| L1.E.1 | Temporary preferences are time-bounded or tentative; context-bounded is a scope property |
| L1.E.2 | Preference promotion requires explicit confirmation or repeated observations |
| L1.F.1 | Working hypotheses are RuntimeCrystalCandidates |
| L1.F.2 | Hypotheses decay signal-first, with time assist and contradiction downgrade |
| L1.G.1 | AMP captures operational harness state only, not raw telemetry |
| L1.H.1 | AMP never captures inferred emotional state |
| L1.I.1 | Runtime capture uses explicit exclusion filter plus redacted rejected-signal audit |
| L2.1 | Durable episodic event_type is a fixed enum |
| L2.2 | Durable episodic retention is forever-by-default with explicit forget/purge |
| L2.3 | Dormancy is retrieval lifecycle, not deletion |
| L3.1 | Runtime memory includes transparency/corrigibility as a purpose |
| L4.1 | Capture filtering and projection routing are separate stages |
| L5.1 | Graduation rules are per-entity and preserve lineage |
| L6.1 | Confidence/source labels appear on every runtime entity and durable frame |
| L-SK-1 | Protected procedural sections are part of v1.5 planning |
| L-SK-2 | User corrections can become validation gates |
| L-BM-1 | Internal benchmarks derive from AMP history |

## Running Ledger of Assumptions

| ID | Assumption | Test |
|---|---|---|
| A1 | Episodic buffer bridges cross-session continuity | Correction survives into next session without restatement |
| A2 | Tool-fit insight derivable from frames | Tool-fit query works after 30+ days |
| A3 | UX buckets can derive from scale axes | User does not need load-bearing bucket schema |
| A4 | Multi-signal scoring attaches sessions correctly | Attachment error rate under 10% |
| A5 | User corrections provide enough validation signal | Held-out corrections distinguish good changes >70% |
| A6 | AMP distinguishes temporary/tentative preference signals from durable preferences | User-labeled sample reaches 80% precision |
| A7 | Working hypotheses create most value while active, before promotion | Compare active hypothesis usage vs promoted crystal usage after 60 days |
| A8 | Dormant snapshots preserve long-tail retrieval value | 50 sampled dormant frames surface in realistic queries at >=80% |

## Separate Scope Items

| Item | Status |
|---|---|
| CocoIndex consolidation engine | post-v1.5 spike |
| Export briefing for cloud tools | separate v1.5/v2 scope |
| Profile schema cross-tool alignment | profile-stage design |
| `gbrain skillify` investigation | separate spike |
| SkillOpt direct source spike | before treating paper claims as VERIFIED |

## Next Work

Start implementation with **RUNTIME-02 — Schema and Types**.
