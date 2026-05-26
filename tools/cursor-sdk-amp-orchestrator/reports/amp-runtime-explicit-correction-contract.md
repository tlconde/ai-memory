# AMP Runtime Explicit Correction Contract

> **Task:** RUNTIME-25 — document and gate the explicit correction runtime contract
> **Base:** `ralph/amp-runtime-semantics-plan`
> **Date:** 2026-05-26
> **Scope:** operator contract + test gates only — no new capture, consolidation, or queue behavior

---

## Purpose

Lock the semantics of **explicit operator corrections** before automated capture or consolidation work lands. Operators and agents must not confuse this path with durable knowledge corrections, runtime queue rows, or promotion pipelines.

---

## Storage model: why `episodic-frame` + `event_type: "correction"`

Explicit corrections persist as typed runtime semantic entities:

| Field | Value |
|-------|--------|
| Record `kind` | `episodic-frame` |
| Payload `event_type` | `"correction"` |
| Payload `source` | `"user_explicit"` |
| Payload `details.capture_path` | `"explicit_operator_correction"` |
| Payload `details.correction_of` | target runtime entity id (`--id`) |

**Why not a new schema?** Runtime semantics already model episodic events as `EpisodicFrame` rows with a fixed `event_type` enum. Corrections are episodic operator feedback — not durable semantic truth, not queue scratch space, not consolidation output. Reusing `episodic-frame` keeps projection, inspect, and storage validation on the existing typed path (RUNTIME-23/24).

**Implementation:** `mapExplicitRuntimeCorrectionToEntityRecord` in `src/amp/runtime-semantics/capture-correction-mapper.ts` → `captureRuntimeCorrection` → `writeRuntimeSemanticEntity`.

---

## `amp runtime correct` vs `core/correction-frame.ts`

These are **different layers** for **different lifecycles**. Do not merge them without an explicit design decision.

| | `amp runtime correct` | `core/correction-frame.ts` |
|--|----------------------|----------------------------|
| **Layer** | Typed runtime semantic storage (local SQLite) | Durable knowledge wire `Frame` (SSA / gbrain) |
| **Trigger** | Operator CLI (`--id`, `--note`) | Programmatic inference feedback (classifier pipeline) |
| **Shape** | `EpisodicFrame` runtime entity | `Frame` with `kind: "episodic"`, `correction_of`, content type `inference_correction` |
| **Content** | Operator note in `summary`; target in `details.correction_of` | Classifier name, `previous_output`, `corrected_output`, `context_fingerprint` |
| **Projection** | Runtime projection: **not durable truth** | Durable knowledge / projection documents (separate pipeline) |
| **Status today** | **Wired** on local typed storage | Core helpers + tests; not invoked by `amp runtime correct` |

`createCorrectionFrame` answers: *“the classifier was wrong about frame X.”*
`amp runtime correct` answers: *“the operator rejects or reframes runtime entity X with this note.”*

---

## Record id behavior (idempotent by default)

**Default record id:** `explicit-correction:${targetEntityId}` (`defaultExplicitCorrectionRecordId`).

| Behavior | Detail |
|----------|--------|
| First capture for target | Writes one `episodic-frame` row |
| Repeat with same default id | Fail-closed: `duplicate_id` — no overwrite, no second projection block |
| Override | Callers/tests/CLI deps may pass explicit `recordId` (e.g. `correction-frame-123`) for multiple corrections per target when needed |

Timestamps: when `occurredAt` / `recordedAt` are omitted, CLI derives deterministic ISO times from capture inputs (`deterministicCorrectionTimestamp`).

**Scope routing:**

- `--id` targets an existing runtime semantic entity id.
- Scope defaults to `project` when project AMP config provides `project_ref`, else `user`.
- Project scope requires `project_ref`; user scope writes to global runtime projection section.

---

## Projection semantics

Corrections materialize through the existing typed path:

`captureRuntimeCorrection` → `materializeRuntimeProjectionFromSource` → runtime projection documents (`global_runtime` / `project_runtime`).

**Formatter contract (RUNTIME-24/25):**

- Active frames: heading **`Episodic correction (not durable truth)`** (`EPISODIC_CORRECTION_ACTIVE_PROJECTION_HEADING`)
- Redacted/sensitive: **`Episodic correction (metadata only)`**
- `activeInstruction: false` — never promoted to agent instructions
- Does not appear in durable `global_projection` / `project_projection` knowledge sections

User-scoped corrections → `global_runtime`. Project-scoped → `project_runtime` for matching `project_ref`.

---

## Current limitations (explicit out-of-scope)

| Limitation | Meaning |
|------------|---------|
| No LLM classifier | Operator must supply `--note`; no automated kind/output inference |
| No automatic transcript capture | Corrections are explicit CLI/API captures only |
| No consolidation / promotion | Corrections stay in typed runtime storage; not promoted to durable knowledge |
| No queue migration | Runtime queue rows are separate; `correct` does not move or rewrite queue items |
| No gbrain writes | Local typed storage + local projection only in this contract |

Queue capture and consolidation wiring remain incomplete (`RUNTIME_STATUS_LOCAL_STORAGE_NOTE`); **correct is wired** on local typed storage alongside inspect and seed.

---

## Operator surfaces

| Surface | Contract |
|---------|----------|
| `amp runtime status` | Lists schemas; NOTE states inspect/seed/**correct** wired on local typed storage |
| `amp runtime correct` | `--id`, `--note` required; persists episodic-frame correction |
| `amp runtime inspect --entity episodic-frame` | Read persisted correction rows |
| `amp status` (shell) | Lists `runtime status/inspect/seed/correct` as wired |

**Regression gates:** `src/amp/runtime-semantics/explicit-correction-contract.test.ts`, `src/amp/cli/runtime.test.ts` — operator text must not regress to “correct unwired”; projection heading must match `EPISODIC_CORRECTION_ACTIVE_PROJECTION_HEADING`.

---

## Code map

| Artifact | Path |
|----------|------|
| Capture | `src/amp/runtime-semantics/capture-correction.ts` |
| Mapper | `src/amp/runtime-semantics/capture-correction-mapper.ts` |
| CLI | `src/amp/cli/runtime.ts` |
| Projection formatter | `src/amp/runtime-semantics/format-projection.ts` |
| Contract strings | `src/amp/runtime-semantics/messages.ts` (operator copy + projection headings) |
| Default record id prefix | `EXPLICIT_CORRECTION_DEFAULT_RECORD_ID_PREFIX` in `capture-correction-mapper.ts` |
| Knowledge correction frames | `src/amp/core/correction-frame.ts` |
| Projection tests | `src/amp/runtime-semantics/capture-correction-projection.test.ts` |

---

## Falsifiable claims

1. `amp runtime correct` writes exactly one typed `episodic-frame` row per successful capture (no queue side effects).
2. Default record id repeat → `duplicate_id`, single projection block.
3. Projection renders correction heading **not durable truth**, never as pending decision / crystal / preference instruction text.
4. Operator status/help text continues to describe **correct as wired**, not unwired.
