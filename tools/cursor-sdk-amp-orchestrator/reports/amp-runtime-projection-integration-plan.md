# AMP Runtime Projection Integration Plan

> **Task:** RUNTIME-05 — formatter registry bridge + projection materialization plan
> **Base:** `ralph/amp-runtime-semantics-plan`
> **Branch:** `ralph/amp-runtime-05-formatter-registry-plan`
> **Date:** 2026-05-26
> **Scope:** registry bridge layer + integration plan only — no `.amp/local/runtime.md` wiring yet

---

## Verdict

**Formatter registry is implemented; projection materialization wiring is planned but not implemented.** The registry maps every `RUNTIME_ENTITY_REGISTRY` kind plus the `current-decision-leaning` sub-entity to schema, parse helpers, optional formatters, projection eligibility, and sensitivity policy. The next wave wires this registry into `buildProjectionDocuments` / `LocalProjectionSource` without touching storage adapters.

---

## Part A — Formatter Registry (implemented)

| Artifact | Path | Role |
|----------|------|------|
| Registry | `src/amp/runtime-semantics/formatter-registry.ts` | Typed kind → schema/parse/format/eligibility map |
| Tests | `src/amp/runtime-semantics/formatter-registry.test.ts` | Coverage, policy, formatter wiring |
| Export | `src/amp/runtime-semantics/index.ts` | Public surface for downstream projection wave |

### Registry entities

| Kind | Schema | Renderable | Projection eligibility | Sensitivity policy |
|------|--------|------------|------------------------|-------------------|
| `unresolved-decision` | UnresolvedDecision | yes | both | none |
| `current-decision-leaning` | CurrentDecisionLeaning | no (sub-entity) | never | none |
| `runtime-preference-candidate` | RuntimePreferenceCandidate | yes | both | none |
| `runtime-crystal-candidate` | RuntimeCrystalCandidate | yes | both | none |
| `harness-operational-state` | HarnessOperationalState | yes | both | none |
| `rejected-signal-log` | RejectedSignalLog | yes (audit only) | **never** | audit_metadata_only |
| `episodic-frame` | EpisodicFrame | yes | both | respect_episodic_sensitivity |
| `dormant-snapshot` | DormantSnapshot | no | **never** | none |

### Sub-entity rule

`current-decision-leaning` is registered but not independently projectable. Projection materialization must join leanings to parent `unresolved-decision` entities and pass them via `FormatUnresolvedDecisionOptions.currentLeaning` — never as standalone blocks.

### Compile-time exhaustiveness

Adding a kind to `RUNTIME_ENTITY_REGISTRY` without a matching formatter registry entry fails the `AssertRuntimeKindsCovered` type guard in `formatter-registry.ts` and the registry coverage test.

---

## Part B — Projection Integration Plan

### 1. Data source design

#### Where buffers live

| Compartment | Current location | Future typed load |
|-------------|------------------|-------------------|
| Attention buffer | Not yet persisted as typed entities; operational state and in-flight decisions/preferences/crystals conceptually live here | `RuntimeStore` attention partition (new adapter wave) |
| Episodic buffer | `RuntimeStore.queueList()` → `RuntimeQueueItem` with raw `EpisodicSignal` payloads | Typed episodic-frame entities validated at enqueue/consolidation boundary |
| Durable episodic | `KnowledgeStore.list()` frames with `kind: "episodic"` | Loaded separately; not mixed with runtime queue raw strings |

**Today:** `LocalProjectionSource` reads `runtime.queueList()` and passes opaque string content to `buildProjectionDocuments`. **Target:** load typed runtime entities by kind from attention + episodic buffer stores, validate with registry `safeParse`, skip invalid rows with audit log (no silent coercion).

#### Entity load sequence (planned)

```
RuntimeStore.attentionList()     ─┐
RuntimeStore.episodicBufferList()─┼─► validate via registry.safeParse
KnowledgeStore.list(episodic)    ─┘       │
                                          group by scope (global vs project)
                                          join current-decision-leaning → parent decision
                                          filter projectionEligibility !== "never"
                                          format via registry.format
```

#### No raw rejected content

- `rejected-signal-log` entries are stored for audit but **never** enter projection load (`projectionEligibility: never`).
- Even the existing `formatRejectedSignalLogForRuntime` omits `redacted_excerpt`; the load path must not call it for projection.
- Episodic frames with `sensitivity: secret_redacted` or default `sensitive` use registry formatter redaction rules.

---

### 2. Projection flow

Planned materialization pipeline (extends `src/amp/projection/materialize.ts`):

1. **Load runtime entities** — attention buffer + episodic buffer (+ optional durable episodic frames flagged for runtime surfacing).
2. **Validate schemas** — `resolveFormatterRegistryEntry(kind)?.safeParse(payload)` at boundary; drop or quarantine invalid rows.
3. **Group by scope** — reuse `resolveProjectionSectionKey(scopeKind, projectRef, scopeProjectRef, "runtime")` from `build-documents.ts`.
4. **Join sub-entities** — index `current-decision-leaning` by `decision_id`; attach to parent `unresolved-decision` before format.
5. **Format via registry** — call `entry.format(entity, options)`; skip when `renderable === false` or format returns `null`.
6. **Apply budget priority** — assign block priority from ordered category list (§3); sort blocks before token budget gate.
7. **Write outputs** — unchanged paths:
   - Project: `<project>/.amp/local/runtime.md`
   - Global: `$AMP_USER_ROOT/runtime/global.md`

**Not in this wave:** replacing durable knowledge projection (`global_projection`, `project_projection`). Only runtime sections gain typed formatting.

---

### 3. Budget priority

When truncation is required, drop lowest-priority blocks first (highest number = dropped first):

| Priority (keep first) | Entity kinds / content |
|-------------------------|------------------------|
| 1 | Active intent (goal-attached operational context — future attention entity) |
| 2 | Active goals (durable episodic goal frames surfaced in runtime section) |
| 3 | Active blocking decisions (`unresolved-decision` with `blocking_goal_id`, status `open`) |
| 4 | Pending corrections (`episodic-frame` with `event_type: correction`, lifecycle `active`) |
| 5 | Operational harness state (`harness-operational-state`, status `active`/`degraded`) |
| 6 | Temporary preferences (`runtime-preference-candidate`, status `active`) |
| 7 | Working hypotheses (`runtime-crystal-candidate`, status `active`/`supported`) |
| 8 | Recent open loops (remaining episodic frames, capped N) |

Registry provides kind metadata; priority assignment lives in a new `runtime-projection-priority.ts` pure module (RUNTIME-06/07 wave).

---

### 4. Safety

| Rule | Enforcement |
|------|-------------|
| No inferred emotional state | Formatters emit only schema fields; no LLM summarization in materialization path |
| No credentials/secrets | Episodic `secret_redacted` → metadata-only; `sensitive` → metadata-only unless explicit opt-in flag (operator-only, not default) |
| Sensitive/secret redaction | Registry `sensitivityPolicy: respect_episodic_sensitivity` delegates to `formatEpisodicFrameForRuntime` |
| Rejected-signal logs never projected | Registry `projectionEligibility: never` + load filter |
| Pending decisions never as facts | `formatUnresolvedDecisionForRuntime` labels open status as "Undecided" |
| Dormant snapshots deferred | `projectionEligibility: never`; deep recall is a future tier |

---

### 5. Testing strategy

| Layer | Scope | Status |
|-------|-------|--------|
| Pure registry tests | `formatter-registry.test.ts` | **VERIFIED** (this wave) |
| Formatter unit tests | `format-projection.test.ts` | **VERIFIED** (RUNTIME-04) |
| Schema tests | `schema.test.ts` | **VERIFIED** (RUNTIME-02) |
| Projection materialization tests | New `runtime-projection-materialize.test.ts` — mock typed entities → markdown blocks | **PLANNED** |
| Integration E2E | Extend `projection-local-materialization.test.ts` with typed runtime fixtures | **PLANNED** |
| Temp project E2E | `amp init` + in-memory stores + `amp projection render --source local --apply` | **PLANNED** |

Materialization tests must assert:
- rejected-signal-log rows absent from runtime markdown
- secret/sensitive episodic content redacted
- current-decision-leaning appears only inside parent decision block
- budget priority drops low-priority blocks before high-priority

---

### 6. Deferred items

| Item | Rationale |
|------|-----------|
| Storage adapter for typed attention/episodic buffers | Registry is storage-agnostic; adapter wave follows schema lock |
| Dormancy snapshot tier | `dormant-snapshot` registered with `never` eligibility; deep recall needs activation hooks (RUNTIME-07) |
| Deep recall | Requires snapshot activation + embedding retrieval spike |
| CocoIndex spike | Report-only (RUNTIME-08); incremental pipeline engine evaluation |
| SkillOpt source spike | External skill optimization re-ingest; roadmap only |

---

## Wiring checklist (next implementation wave)

- [ ] Add `loadTypedRuntimeEntities(runtime: RuntimeStore): TypedRuntimeEntity[]` adapter stub
- [ ] Replace `runtimeItemToBlock` string passthrough with registry format path in `build-documents.ts`
- [ ] Add `assignRuntimeBlockPriority(entity): number` module
- [ ] Join `current-decision-leaning` sub-entities before formatting decisions
- [ ] Filter `projectionEligibility === "never"` at load boundary
- [ ] Add materialization tests + extend E2E
- [ ] Document operator behavior in projection report companion

---

## Verification (this wave)

```bash
npm run typecheck
node --import tsx --test \
  src/amp/runtime-semantics/schema.test.ts \
  src/amp/runtime-semantics/format-projection.test.ts \
  src/amp/runtime-semantics/formatter-registry.test.ts
npm run amp:acceptance
git diff --check
```

---

## Changed files

| File | Change |
|------|--------|
| `src/amp/runtime-semantics/formatter-registry.ts` | New typed registry |
| `src/amp/runtime-semantics/formatter-registry.test.ts` | Registry tests |
| `src/amp/runtime-semantics/index.ts` | Export registry surface |
| `tools/cursor-sdk-amp-orchestrator/reports/amp-runtime-projection-integration-plan.md` | This plan |

---

## Claim labels

| Claim | Label |
|-------|-------|
| Every RUNTIME_ENTITY_REGISTRY kind has a formatter registry entry | **VERIFIED** — registry test + compile-time guard |
| rejected-signal-log never projectable | **VERIFIED** — registry policy test |
| current-decision-leaning is sub-entity only | **VERIFIED** — registry metadata test |
| episodic-frame formatter respects sensitivity redaction via registry | **VERIFIED** — registry wiring test |
| Projection materialization uses registry | **PLANNED** — not wired this wave |
| `.amp/local/runtime.md` typed output | **PLANNED** — not wired this wave |

---

## Residual risks

1. **RuntimeStore still queues opaque strings** — until typed adapter lands, registry is unused in materialization; risk of drift between queue payload shape and schema.
2. **Priority truncation not implemented** — budget gate exists but intelligent drop-by-priority remains PROVISIONAL (see `amp-local-projection-materialization.md`).
3. **Attention buffer location unset** — plan assumes future partition; exact store API TBD in storage wave.
4. **Sub-entity join ordering** — leanings must be indexed before decision format pass; integration tests must cover orphan leanings.

---

## Thermo-nuclear code quality review

**Verdict: concerns** — safe to merge as a bridge milestone; address typed lookup and data-driven registry before RUNTIME-06 materialization wiring.

### Findings by severity

#### Critical
None.

#### Major

1. **Public registry interface erases entity types to `unknown`** — `RuntimeFormatterRegistryEntry.format` loses kind-specific options typing. Integration will need casts unless a discriminated union or generic lookup is added before RUNTIME-06.

2. **Eight near-identical entry blocks** — each kind manually repeats schema/parse/policy fields already known from `RUNTIME_ENTITY_REGISTRY`. Consider data-driven build from registry + policy overlay before the next wave.

3. **`sensitivityPolicy` and `renderable` are declarative only** — registry does not enforce them at format time. Materialization consumer must respect metadata or a single `formatForProjection` helper should enforce policy.

4. **`isProjectableFormatterKind` collapses eligibility to boolean** — `global`/`project`/`both` variants exist but only `both` and `never` are used. Scope-aware filtering needs a richer API before materialization.

#### Minor

5. Format wrapper silently returns `null` on re-parse failure (untested).
6. Overlapping semantics between `renderable` and `projectionEligibility` (e.g. `rejected-signal-log`: renderable true, eligibility never).
7. Format wiring tests cover 2 of 6 formatters via registry path.
8. Redundant derived exports (`RUNTIME_FORMATTER_PROJECTION_ELIGIBILITY`, `FORMATTER_REGISTRY_BY_KIND`).
9. Compile-time guard is one-directional (entity kinds ⊆ formatter kinds only).

#### Nits

10. Defensive throw in `getFormatterRegistryEntry` unreachable for typed kinds.
11. Redundant `parse`/`safeParse` re-assignment in `createRegistryEntry` spread.

### Maintainability

| Dimension | Assessment |
|-----------|------------|
| 1k-line rule | Pass (~293 LOC registry, ~167 LOC tests) |
| Spaghetti | Pass — linear module |
| Abstraction quality | Mixed — factory helps, copy-paste entries hurt |
| Future growth | Concern — each new kind adds ~15 lines without data-driven refactor |

### Recommendation

Merge as bridge milestone. Track before RUNTIME-06: typed lookup API, data-driven registry table, policy enforcement layer, scope-aware projection helper, parametric format parity tests.
