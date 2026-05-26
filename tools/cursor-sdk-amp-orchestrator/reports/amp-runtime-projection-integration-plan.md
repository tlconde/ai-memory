# AMP Runtime Projection Integration Plan

> **Task:** RUNTIME-05 — formatter registry bridge + projection materialization plan
> **Fix:** RUNTIME-05-FIX — typed lookup, data-driven registry, policy enforcement
> **Base:** `ralph/amp-runtime-semantics-plan`
> **Branch:** `ralph/amp-runtime-05-fix-registry`
> **Date:** 2026-05-26
> **Scope:** registry bridge layer + integration plan only — no `.amp/local/runtime.md` wiring yet

---

## Verdict

**Formatter registry is ready for RUNTIME-06 consumption.** The registry is data-driven from `RUNTIME_ENTITY_REGISTRY`, policy is enforced in `formatRuntimeEntityForProjection`, and typed overloads replace the prior type-erased `entry.format(entity: unknown)` surface. Projection materialization wiring remains planned but not implemented.

---

## Part A — Formatter Registry (implemented)

| Artifact | Path | Role |
|----------|------|------|
| Registry | `src/amp/runtime-semantics/formatter-registry.ts` | Data-driven kind → schema/policy map + typed projection helper |
| Tests | `src/amp/runtime-semantics/formatter-registry.test.ts` | Coverage, policy enforcement, typed helper parity |
| Export | `src/amp/runtime-semantics/index.ts` | Public surface for downstream projection wave |

### Consumer API (RUNTIME-05-FIX)

| Function | Purpose |
|----------|---------|
| `formatRuntimeEntityForProjection(kind, input, options?)` | Boundary parse + policy gate + format; returns `{ ok, formatted }` or `{ ok: false, error, reason }` |
| `parseRuntimeEntityAtBoundary(kind, input)` | Schema validation only |
| `getFormatterRegistryEntry(kind)` | Introspection: schema, policy, safeParse |
| `PROJECTABLE_FORMATTER_KINDS` | Exact set of standalone projectable kinds |
| `isProjectableFormatterKind(kind)` | Type guard for projectable kinds |

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

### Data-driven construction

- Entity rows built from `RUNTIME_ENTITY_REGISTRY.map(buildRegistryEntry)` — schemaName comes from registry, schema/safeParse from `ENTITY_SCHEMA_BUNDLES`.
- Policy overrides in `FORMATTER_POLICY_BY_KIND` keyed by kind; sub-entity appended separately.
- Compile-time guards: every entity kind has policy + schema bundle; every projectable kind has format in bundle.

### Sub-entity rule

`current-decision-leaning` is registered but not independently projectable. `formatRuntimeEntityForProjection("current-decision-leaning", …)` returns `{ ok: false, reason: "not_projectable" }`. Materialization must join leanings to parent `unresolved-decision` entities via `FormatUnresolvedDecisionOptions.currentLeaning`.

### Policy enforcement

`formatRuntimeEntityForProjection` enforces before formatting:

| Check | Failure reason |
|-------|----------------|
| Unknown kind slug | `unknown_kind` |
| `projectionEligibility === "never"` | `not_projectable` |
| `renderable === false` | `not_renderable` |
| Schema validation failure | `invalid_input` |

---

## Part B — Projection Integration Plan

### 1. Data source design

#### Where buffers live

| Compartment | Current location | Future typed load |
|-------------|------------------|-------------------|
| Attention buffer | Not yet persisted as typed entities | `RuntimeStore` attention partition (new adapter wave) |
| Episodic buffer | `RuntimeStore.queueList()` → raw `EpisodicSignal` | Typed episodic-frame entities validated at boundary |
| Durable episodic | `KnowledgeStore.list()` frames with `kind: "episodic"` | Loaded separately |

**Target load path:** validate via `parseRuntimeEntityAtBoundary`, format via `formatRuntimeEntityForProjection`, skip `ok: false` rows with audit log.

#### Entity load sequence (planned)

```
RuntimeStore.attentionList()     ─┐
RuntimeStore.episodicBufferList()─┼─► parseRuntimeEntityAtBoundary
KnowledgeStore.list(episodic)    ─┘       │
                                          join current-decision-leaning → parent decision
                                          formatRuntimeEntityForProjection
                                          group by scope (global vs project)
```

#### No raw rejected content

- `rejected-signal-log` blocked at helper (`not_projectable`).
- Episodic redaction via `formatEpisodicFrameForRuntime` through bundle dispatch.

---

### 2. Projection flow

1. **Load runtime entities** — attention + episodic buffer (+ optional durable episodic).
2. **Validate schemas** — `parseRuntimeEntityAtBoundary(kind, payload)`.
3. **Join sub-entities** — index `current-decision-leaning` by `decision_id`; attach to parent decision options.
4. **Format via registry** — `formatRuntimeEntityForProjection(kind, parsed, options)`; skip `ok: false`.
5. **Group by scope** — reuse `resolveProjectionSectionKey` from `build-documents.ts`.
6. **Apply budget priority** — ordered category list (§3).
7. **Write outputs** — `.amp/local/runtime.md` and global runtime paths.

**Not in this wave:** durable knowledge projection sections.

---

### 3. Budget priority

| Priority (keep first) | Entity kinds / content |
|-------------------------|------------------------|
| 1 | Active intent |
| 2 | Active goals |
| 3 | Active blocking decisions |
| 4 | Pending corrections |
| 5 | Operational harness state |
| 6 | Temporary preferences |
| 7 | Working hypotheses |
| 8 | Recent open loops |

Priority assignment lives in future `runtime-projection-priority.ts` (RUNTIME-06/07).

---

### 4. Safety

| Rule | Enforcement |
|------|-------------|
| No inferred emotional state | Formatters emit schema fields only |
| No credentials/secrets | Episodic `secret_redacted` / `sensitive` redaction via formatter |
| Rejected-signal logs never projected | Helper `not_projectable` gate |
| Pending decisions never as facts | `formatUnresolvedDecisionForRuntime` labels "Undecided" |
| Dormant snapshots deferred | Helper `not_projectable` gate |

---

### 5. Testing strategy

| Layer | Status |
|-------|--------|
| Registry + typed helper tests | **VERIFIED** (RUNTIME-05-FIX) |
| Formatter unit tests | **VERIFIED** (RUNTIME-04) |
| Schema tests | **VERIFIED** (RUNTIME-02) |
| Projection materialization tests | **PLANNED** |
| Integration E2E | **PLANNED** |

---

### 6. Deferred items

| Item | Rationale |
|------|-----------|
| Storage adapter for typed buffers | Registry is storage-agnostic |
| Dormancy snapshot tier / deep recall | RUNTIME-07 |
| CocoIndex spike | RUNTIME-08 |
| SkillOpt source spike | Roadmap |
| Scope-aware projection filtering (`global` vs `project`) | RUNTIME-06; policy values exist but all projectable kinds use `both` today |

---

## Wiring checklist (RUNTIME-06)

- [ ] Add `loadTypedRuntimeEntities(runtime: RuntimeStore)` adapter stub
- [ ] Replace `runtimeItemToBlock` string passthrough with `formatRuntimeEntityForProjection` in `build-documents.ts`
- [ ] Add `assignRuntimeBlockPriority(entity): number` module
- [ ] Join `current-decision-leaning` sub-entities before formatting decisions
- [ ] Add materialization tests + extend E2E

---

## Verification

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

## Changed files (RUNTIME-05-FIX)

| File | Change |
|------|--------|
| `src/amp/runtime-semantics/formatter-registry.ts` | Data-driven registry, typed helper, policy enforcement |
| `src/amp/runtime-semantics/formatter-registry.test.ts` | Expanded policy + helper tests |
| `src/amp/runtime-semantics/index.ts` | Export typed helper surface |
| `tools/cursor-sdk-amp-orchestrator/reports/amp-runtime-projection-integration-plan.md` | This plan |

---

## Claim labels

| Claim | Label |
|-------|-------|
| Every RUNTIME_ENTITY_REGISTRY kind has registry entry + policy | **VERIFIED** |
| Typed projection helper with structured errors | **VERIFIED** |
| Policy enforced at format boundary | **VERIFIED** — eligibility/renderable gates |
| rejected-signal-log never projectable | **VERIFIED** |
| current-decision-leaning sub-entity only | **VERIFIED** |
| All 5 projectable kinds format via helper | **VERIFIED** |
| Projection materialization uses registry | **PLANNED** |
| `.amp/local/runtime.md` typed output | **PLANNED** |

---

## Residual risks

1. **RuntimeStore still queues opaque strings** — typed adapter wave required before materialization can consume registry at scale.
2. **Priority truncation not implemented** — budget gate exists; intelligent drop-by-priority remains PROVISIONAL.
3. **Attention buffer location unset** — exact store API TBD in storage wave.
4. **Sub-entity join ordering** — leanings must be indexed before decision format pass; integration tests must cover orphan leanings.
5. **Scope-aware filtering deferred** — `ProjectionEligibility` includes `global`/`project`/`both` but only `both`/`never` used today; RUNTIME-06 must add section-aware filtering.

### Resolved (RUNTIME-05-FIX)

| Prior risk | Status |
|------------|--------|
| Type erasure at public boundary (`format(entity: unknown)`) | **RESOLVED** — `formatRuntimeEntityForProjection` with overloads |
| Policy fields declarative only | **RESOLVED** — helper enforces eligibility/renderable before format |
| Eight copy-paste registry entry blocks | **RESOLVED** — data-driven from `RUNTIME_ENTITY_REGISTRY` |

---

## Thermo-nuclear code quality review (RUNTIME-05-FIX)

**Verdict: concerns (improved — mergeable, ready for RUNTIME-06 wiring via helper only)**

### Resolved from prior review

| Prior finding | Status |
|---------------|--------|
| Public `entry.format(entity: unknown)` | Fixed — removed; typed helper is consumer API |
| Eight copy-paste entry blocks | Fixed — `RUNTIME_ENTITY_REGISTRY.map(buildRegistryEntry)` |
| Silent re-parse null wrapper | Fixed — structured `{ ok: false, reason: "invalid_input" }` |
| Policy not enforced | Partial → mostly fixed — eligibility/renderable enforced at helper |

### Remaining findings

#### Major

1. **Format dispatch uses switch delegating to bundles** — `ENTITY_SCHEMA_BUNDLES[kind].format` is the single formatter source; exhaustive switch exists only for TypeScript narrowing. Acceptable for RUNTIME-06; one table if a third kind category appears.

2. **`sensitivityPolicy` not read at helper boundary** — episodic redaction works because bundle delegates to `formatEpisodicFrameForRuntime`. Document that `formatRuntimeEntityForProjection` is the supported entry point.

#### Minor

3. **`not_renderable` branch untested** — current policy table hits `not_projectable` first for non-renderable kinds. Latent path only.
4. **Scope-aware projection API deferred** — `isProjectableFormatterKind` checks renderable but not `global`/`project` section.
5. **Internal casts in format dispatch switch** — bounded to projectable kinds after parse; acceptable boundary pattern.

### Maintainability

| Dimension | Assessment |
|-----------|------------|
| 1k-line rule | Pass (~470 LOC registry, ~330 LOC tests) |
| Spaghetti | Pass |
| Abstraction quality | Good — data-driven rows + single helper |
| Future growth | Add kind → policy map + schema bundle + compile guard |

### Recommendation

**Merge RUNTIME-05-FIX.** Wire RUNTIME-06 materialization against `formatRuntimeEntityForProjection` only — not direct formatter imports.
