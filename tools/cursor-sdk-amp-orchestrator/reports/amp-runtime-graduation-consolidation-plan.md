# AMP Runtime Graduation / Consolidation Plan

> **Owner:** Codex planning pass  
> **Date:** 2026-05-27  
> **Branch:** `ralph/amp-runtime-semantics-plan`  
> **Scope:** plan/spec only — no implementation in this report  
> **Inputs:** `amp-runtime-episodic-semantics.md`, current runtime semantics implementation through typed preference-candidate capture

---

## Executive Verdict

AMP now has the typed runtime storage path needed for local dogfood:

- typed runtime entity schemas
- projection-safe formatting
- storage reader/writer
- local projection wiring
- explicit correction capture
- rejected-signal audit capture
- runtime preference-candidate capture
- facade-level provenance gates

The next architectural step is **graduation**: deterministic movement from typed runtime entities into durable AMP frames or proposal queues.

Do **not** wire broad automatic consolidation yet. First build a narrow, pure graduation-planning layer that:

1. reads typed runtime records
2. validates them through the existing boundary parsers
3. emits an auditable `GraduationPlan`
4. performs no writes by default
5. only writes durable frames in a later explicit apply step

This keeps runtime memory from becoming permanent truth too early.

---

## Current Implementation State

| Area | Status |
|---|---|
| Runtime schemas | Implemented in `src/amp/runtime-semantics/schema.ts` |
| Runtime storage | Implemented via `runtime_semantic_entity` table |
| Runtime projection | Implemented via `materializeRuntimeProjectionFromSource` |
| Runtime inspect/seed/correct | Wired for local typed storage |
| Explicit correction capture | Writes `episodic-frame` correction rows |
| Rejected signal capture | Writes `rejected-signal-log` audit rows |
| Preference candidate capture | Writes `runtime-preference-candidate` rows |
| Runtime capture facade | Canonical production write boundary |
| Provenance gates | Facade-only write gate |
| Graduation to durable frames | Not implemented |
| Proposal queue | Not implemented |
| Automatic capture/consolidation | Not implemented |

---

## Core Design Principle

Graduation is a **reviewable transformation**, not storage cleanup.

Runtime rows remain source facts about current/in-flight state. Durable frames are longer-lived knowledge artifacts. Moving from runtime to durable must therefore produce an explicit, auditable decision:

```text
RuntimeSemanticEntityRecord
  -> parse + classify + rule evaluation
  -> GraduationDecision
  -> optional durable Frame write / proposal queue entry
  -> runtime row status update only when safe
```

For the first implementation slice, stop at `GraduationDecision`. No durable writes.

---

## Frame Schema Reality Check

The durable frame wire schema is intentionally simple:

```text
Frame {
  id
  kind: episodic | semantic | crystal
  content: string | object
  source
  created_at
  scope
  curation_mode
  valid_from?
  valid_until?
  confidence?
  confidence_basis?
  kind_provenance?
  correction_of?
  conditions?
  refutations?
  refinement_history?
}
```

Runtime entities have richer shape than durable frames. Graduation must map rich runtime fields into:

- `Frame.kind`
- `Frame.content`
- `Frame.scope`
- `Frame.source`
- `Frame.created_at`
- `Frame.valid_until`
- `Frame.confidence`
- `Frame.confidence_basis`
- `Frame.kind_provenance`
- `Frame.conditions`
- `Frame.refutations`
- `Frame.refinement_history`

Do not add durable frame schema fields just to mirror runtime entities. Use structured `content` and existing metadata blocks until a separate durable schema revision is justified.

---

## Graduation Decision Model

Add a pure planning model before any writer:

```ts
type RuntimeGraduationDecision =
  | {
      status: "graduate";
      recordId: string;
      runtimeKind: RuntimeFormatterRegistryKind;
      targetFrame: Frame;
      reason: RuntimeGraduationReason;
    }
  | {
      status: "defer";
      recordId: string;
      runtimeKind: RuntimeFormatterRegistryKind;
      reason: RuntimeGraduationDeferralReason;
      message: string;
    }
  | {
      status: "proposal_required";
      recordId: string;
      runtimeKind: RuntimeFormatterRegistryKind;
      reason: RuntimeGraduationProposalReason;
      proposal: RuntimeGraduationProposal;
    }
  | {
      status: "skip";
      recordId: string;
      runtimeKind: RuntimeFormatterRegistryKind;
      reason: RuntimeGraduationSkipReason;
      message: string;
    };
```

Suggested result envelope:

```ts
interface RuntimeGraduationPlan {
  generatedAt: string;
  decisions: readonly RuntimeGraduationDecision[];
  summary: {
    graduate: number;
    defer: number;
    proposal_required: number;
    skip: number;
  };
}
```

This shape is intentionally parallel to projection materialization: deterministic inputs, structured skipped/blocked states, no silent drops.

---

## Entity-Specific Rules

### 1. RuntimePreferenceCandidate -> Semantic Frame

**Graduate when either:**

- explicit confirmation signal exists, or
- `promotion_evidence.repetition_count >= 3`
- and `promotion_evidence.independent_sessions >= 2`
- and `status === "active"`
- and no contradiction marker is present

Current schema has no direct contradiction-list field beyond `status: "contradicted"`. For now:

- `status === "contradicted"` -> `proposal_required`
- `status === "expired"` -> `defer`
- `status === "promoted"` -> `skip`
- `status === "abandoned"` -> `skip`

**Durable frame mapping:**

```text
kind: semantic
content:
  type: "preference"
  statement
  mode
  context
  source_runtime_entity_id
source:
  surface: "amp-runtime-graduation"
  captured_at: last_observed_at
created_at: last_observed_at
scope: runtime scope
curation_mode: personal
valid_until: expires_at for time_bounded preferences, null/omitted otherwise
confidence: low/medium/high mapped to numeric confidence
confidence_basis:
  type: direct_statement if explicit_confirmation_signal_id exists
  type: experience_confidence otherwise
kind_provenance:
  default_inferred: semantic
  default_basis: "runtime-graduation:preference-candidate"
  final_kind_source: default
```

**Important:** time-bounded preferences may graduate into semantic frames with `valid_until`. They are durable records of a bounded preference, not permanent instructions.

### 2. RuntimeCrystalCandidate -> Crystal Frame

**Graduate only when:**

- `status === "supported"`
- contradiction score is `low`
- at least one `successful_predictions` item exists
- lineage has enough traceability:
  - `source_signal_ids` non-empty, or
  - `lineage.transform_id` present

**Do not auto-graduate active hypotheses.** They remain runtime working hypotheses.

**Durable frame mapping:**

```text
kind: crystal
content:
  type: "working_hypothesis_promotion"
  claim
  supporting_evidence_refs
  contradicting_evidence_refs
  predicted_observations
  successful_predictions
  failed_predictions
  source_runtime_entity_id
source:
  surface: "amp-runtime-graduation"
  captured_at: last_referenced_at
created_at: last_referenced_at
scope: runtime scope
curation_mode: personal
confidence: mapped from runtime confidence
confidence_basis:
  type: deductive
  notes: include contradiction_score and successful prediction count
refutations: contradicting_evidence_refs
kind_provenance:
  default_inferred: crystal
  default_basis: "runtime-graduation:crystal-candidate"
```

Operator review is still required for crystal promotion. First implementation should emit `proposal_required`, not write directly, unless the CLI explicitly applies with a review flag in a later slice.

### 3. UnresolvedDecision -> Semantic Frame

**Graduate when:**

- `status === "decided"`
- `selected_option_id` is set
- selected option exists in `options`
- provenance is non-empty

**Defer when:**

- `status === "open"`

**Skip when:**

- `status === "abandoned"`

**Proposal required when:**

- decided but selected option is missing/orphaned
- selected option conflicts with rejected option data

**Durable frame mapping:**

```text
kind: semantic
content:
  type: "decision"
  question
  selected_option
  options
  urgency
  owner
  decision_due?
  source_runtime_entity_id
source:
  surface: "amp-runtime-graduation"
  captured_at: last_touched_at
created_at: last_touched_at
scope: runtime scope
curation_mode: personal
confidence_basis:
  type: direct_statement if owner/user provenance supports it
  type: source_attestation otherwise
kind_provenance:
  default_inferred: semantic
  default_basis: "runtime-graduation:resolved-decision"
```

### 4. EpisodicFrame Runtime Rows -> Durable Episodic Frames

Explicit correction captures already use runtime `episodic-frame` rows.

First graduation implementation should **not** try to map runtime `EpisodicFrame` to durable `Frame` yet, because there are two different models:

- runtime `EpisodicFrame` schema in `runtime-semantics/schema.ts`
- durable `Frame` schema with `kind: "episodic"` in `core/frame-schema.ts`

Plan a separate mapper:

```text
Runtime EpisodicFrame -> durable Frame(kind="episodic")
```

Rules:

- `lifecycle_state === "deleted"` -> skip
- `sensitivity === "secret_redacted"` -> only metadata/hash content
- `event_type === "correction"` -> durable episodic frame with `correction_of` when available
- preserve `source_signals`, `evidence_refs`, and runtime entity id inside structured content/refinement history

This is important, but it should come after preference and decision graduation because corrections already project safely and dogfood value is mostly in runtime continuity.

### 5. RejectedSignalLog -> Never Graduates

Rejected signal logs are audit-only runtime records.

Graduation behavior:

```text
status: skip
reason: "audit_only"
message: "RejectedSignalLog is retained as runtime audit metadata and never graduates to durable knowledge."
```

### 6. HarnessOperationalState -> Durable Episodic or Crystal Later

Do not graduate active harness state in the first slice.

Future rules:

- closed/recovered harness event -> durable episodic frame
- repeated tool-fit pattern -> crystal frame proposal

Current behavior:

```text
active/degraded/unavailable -> defer
closed -> proposal_required or defer until episodic mapper exists
```

### 7. DormantSnapshot -> Never Graduates

Dormant snapshots are retrieval beacons, not knowledge.

Graduation behavior:

```text
status: skip
reason: "retrieval_beacon_only"
```

### 8. CurrentDecisionLeaning -> Never Standalone Graduates

Current leanings are transient sub-entities. They can affect unresolved decision projection but do not become durable frames alone.

Graduation behavior:

```text
status: skip
reason: "sub_entity_only"
```

---

## Proposal Queue

The proposal queue should be its own explicit runtime concept, but do not implement it in the first mapper slice.

Use `proposal_required` decisions as the intermediate representation.

Proposal-required cases:

- project -> user/universal promotion
- contradicted preference candidate
- crystal candidate ready for promotion
- decided decision with malformed selected option
- any scope/curation change requiring operator review
- conflict with already-promoted durable frame

Later storage options:

1. typed runtime semantic entity row with a new `RuntimeGraduationProposal` schema
2. durable episodic frame with `event_type: "proposal_event"` if/when runtime episodic mapper exists
3. separate proposal table

Recommendation: start with **in-memory plan output only**, then decide storage after the first CLI review experience.

---

## First Implementation Slice

### RUNTIME-GRAD-01 — Pure Graduation Planner

Build:

- `src/amp/runtime-semantics/graduation-planner.ts`
- `src/amp/runtime-semantics/graduation-planner.test.ts`

Inputs:

- `readonly RuntimeSemanticEntityRecord[]`
- `generatedAt`
- optional `projectRef`

Outputs:

- `RuntimeGraduationPlan`

Rules:

- parse through existing `parseRuntimeEntityAtBoundary`
- reuse envelope alignment helpers
- never write to `KnowledgeStore`
- never mutate `RuntimeStore`
- never delete runtime records
- preserve source order in decisions
- include skip/defer/proposal reasons

Acceptance tests:

- active preference below threshold -> defer
- preference with explicit confirmation -> graduate semantic frame
- preference with 3 repetitions across 2 sessions -> graduate semantic frame
- contradicted preference -> proposal_required
- expired preference -> defer
- decided valid decision -> graduate semantic frame
- open decision -> defer
- abandoned decision -> skip
- supported crystal -> proposal_required, not direct graduate
- rejected-signal-log -> skip audit_only
- current-decision-leaning -> skip sub_entity_only
- invalid payload -> skip invalid_input
- project scope mismatch -> skip scope_mismatch

### RUNTIME-GRAD-02 — CLI Review Command

After planner:

```bash
amp runtime graduation plan [--json] [--entity <kind>]
```

Read from `RuntimeStoreSemanticEntityReader`, emit plan only.

No apply flag yet.

### RUNTIME-GRAD-03 — Preference Candidate Apply

Only after review command is useful:

```bash
amp runtime graduation apply --kind runtime-preference-candidate --id <id>
```

Narrow apply:

- writes only semantic frames for already-eligible preference candidates
- no crystal apply
- no decision apply unless valid decided status
- no proposal queue storage
- no gbrain live mutation by default

---

## Cursor Implementation Prompt 1

```text
Implement RUNTIME-GRAD-01: a pure runtime graduation planner.

Scope:
- Add `src/amp/runtime-semantics/graduation-planner.ts`
- Add `src/amp/runtime-semantics/graduation-planner.test.ts`
- Export the planner types/functions from `src/amp/runtime-semantics/index.ts`
- No CLI.
- No KnowledgeStore writes.
- No RuntimeStore mutation.
- No gbrain, projection, capture, or consolidation wiring.

Planner input:
- `records: readonly RuntimeSemanticEntityRecord[]`
- `generatedAt: string`
- optional `projectRef?: string`

Planner output:
- `RuntimeGraduationPlan` with decisions in source order and summary counts.

Rules:
- Parse payloads through the existing runtime formatter/schema boundary.
- Reuse existing record/payload envelope alignment and section/scope logic where appropriate.
- RuntimePreferenceCandidate:
  - active + explicit_confirmation_signal_id => `graduate` semantic Frame
  - active + repetition_count >= 3 + independent_sessions >= 2 => `graduate` semantic Frame
  - contradicted => `proposal_required`
  - expired => `defer`
  - promoted/abandoned => `skip`
- UnresolvedDecision:
  - decided + valid selected_option_id => `graduate` semantic Frame
  - open => `defer`
  - abandoned => `skip`
  - decided with missing/orphan selected option => `proposal_required`
- RuntimeCrystalCandidate:
  - supported + low contradiction + at least one successful prediction + lineage => `proposal_required` for crystal promotion
  - refuted/stale/promoted/abandoned => `skip` or `defer` according to safest semantics
  - active => `defer`
- RejectedSignalLog => `skip` audit_only
- DormantSnapshot => `skip` retrieval_beacon_only
- CurrentDecisionLeaning => `skip` sub_entity_only
- HarnessOperationalState => `defer` unless clearly closed, then `defer` with episodic_mapper_not_implemented
- EpisodicFrame => `defer` with episodic_mapper_not_implemented

Frame mapping:
- Use `createFrame` from `core/frame-schema.ts`
- Preserve runtime entity id inside structured `content`
- Use `source.surface = "amp-runtime-graduation"`
- Use runtime timestamps for `created_at`
- Use scope from runtime record
- Use `curation_mode: "personal"`
- Use `kind_provenance.default_basis` values from the graduation plan report

Tests:
- Cover each rule category above.
- Verify no writes/mutations by keeping the planner pure.
- Verify generated frames pass Frame schema validation.
- Verify decision order follows input order.
- Verify summary counts.

Validation:
- npm run typecheck
- node --import tsx --test src/amp/runtime-semantics/graduation-planner.test.ts src/amp/runtime-semantics/*.test.ts
- npm run amp:acceptance
- git diff --check

After implementation, run /thermo-nuclear-code-quality-review and include the review output in the report.
```

---

## Composer Subagent Prompt 1

Use this when running the implementation through Composer with subagents. The architecture in this report is already decided; subagents should gather facts, implement the narrow slice, and verify it. Do not ask subagents to redesign graduation semantics.

```text
Implement RUNTIME-GRAD-01: a pure runtime graduation planner.

Use subagents as follows:

1. Recon subagent
   - Inspect only the existing runtime-semantics modules, `core/frame-schema.ts`, and relevant tests.
   - Report the exact existing helpers/types to reuse for:
     - `RuntimeSemanticEntityRecord`
     - runtime entity parsing/validation
     - record/payload envelope alignment
     - Frame creation/validation
   - Do not propose architecture changes beyond identifying reusable APIs.

2. Implementation subagent
   - Add `src/amp/runtime-semantics/graduation-planner.ts`.
   - Add `src/amp/runtime-semantics/graduation-planner.test.ts`.
   - Export the planner types/functions from `src/amp/runtime-semantics/index.ts`.
   - Keep the planner pure:
     - no CLI
     - no KnowledgeStore writes
     - no RuntimeStore mutation
     - no gbrain
     - no projection wiring
     - no capture/consolidation wiring

3. Test subagent
   - Add focused tests for every rule category below.
   - Verify generated frames pass Frame schema validation.
   - Verify decision order follows input order.
   - Verify summary counts.
   - Verify the planner performs no writes/mutations by construction.

4. Review subagent
   - Review for scope creep, accidental persistence, schema drift, and fact-like promotion of uncertain runtime state.
   - Confirm the implementation stays within this prompt and this report.

Planner input:
- `records: readonly RuntimeSemanticEntityRecord[]`
- `generatedAt: string`
- optional `projectRef?: string`

Planner output:
- `RuntimeGraduationPlan` with decisions in source order and summary counts.

Rules:
- Parse payloads through the existing runtime formatter/schema boundary.
- Reuse existing record/payload envelope alignment and section/scope logic where appropriate.
- RuntimePreferenceCandidate:
  - active + explicit_confirmation_signal_id => `graduate` semantic Frame
  - active + repetition_count >= 3 + independent_sessions >= 2 => `graduate` semantic Frame
  - contradicted => `proposal_required`
  - expired => `defer`
  - promoted/abandoned => `skip`
- UnresolvedDecision:
  - decided + valid selected_option_id => `graduate` semantic Frame
  - open => `defer`
  - abandoned => `skip`
  - decided with missing/orphan selected option => `proposal_required`
- RuntimeCrystalCandidate:
  - supported + low contradiction + at least one successful prediction + lineage => `proposal_required` for crystal promotion
  - refuted/stale/promoted/abandoned => `skip` or `defer` according to safest semantics
  - active => `defer`
- RejectedSignalLog => `skip` audit_only
- DormantSnapshot => `skip` retrieval_beacon_only
- CurrentDecisionLeaning => `skip` sub_entity_only
- HarnessOperationalState => `defer` unless clearly closed, then `defer` with episodic_mapper_not_implemented
- EpisodicFrame => `defer` with episodic_mapper_not_implemented

Frame mapping:
- Use `createFrame` from `core/frame-schema.ts`
- Preserve runtime entity id inside structured `content`
- Use `source.surface = "amp-runtime-graduation"`
- Use runtime timestamps for `created_at`
- Use scope from runtime record
- Use `curation_mode: "personal"`
- Use `kind_provenance.default_basis` values from the graduation plan report

Validation:
- npm run typecheck
- node --import tsx --test src/amp/runtime-semantics/graduation-planner.test.ts src/amp/runtime-semantics/*.test.ts
- npm run amp:acceptance
- git diff --check

Final report:
- Summarize files changed.
- Include verification results.
- Include subagent findings only when they changed implementation decisions.
- Include residual risks.
- After implementation, run /thermo-nuclear-code-quality-review and include the review output in the report.
```

---

## Thermo-Nuclear Review

**Verdict:** approve plan, with one hard constraint.

The plan is deliberately conservative: it starts with a pure planner, not an apply path. This matches AMP's locked semantics that runtime memory must not become durable truth too early. The first implementation slice is testable, deterministic, and reversible because it has no side effects.

**Hard constraint:** do not implement `apply` in the same task as the planner. If planner and writer land together, review becomes harder and the first user-facing consolidation behavior will be less auditable.

**Main risk:** durable `Frame.content` can become an untyped dumping ground. The first planner tests must assert stable content `type` strings (`"preference"`, `"decision"`, etc.) so consumers can query these frames predictably.

**Secondary risk:** the words "graduation" and "consolidation" can blur. In this plan:

- graduation planner = pure decision and frame candidate generation
- consolidation/apply = later side-effectful write to knowledge store

Keep that boundary loud in code comments and CLI copy.
