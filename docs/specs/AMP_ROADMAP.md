# AMP Roadmap

> **Status:** active execution roadmap. Sole source of truth for "what to build next" on the `AMP` branch.
> **Date:** 2026-05-31
> **Companion specs:** `AMP_CONSOLIDATED_SPEC.md` (v2, 24 May 2026) + `AMP_SPEC_UPDATE_OPTIMIZER_AND_UPSTREAM_SYNC.md` (delta, 27 May 2026)
> **v1 baseline:** `docs/plans/AMP_V1_ACCEPTANCE_REPORT.md` (gate `82962bf`, `npm run amp:acceptance`)
> **Supersedes:** `docs/plans/AMP_POST_V1_OPTIMIZER_UPSTREAM_PLAN.md` (kept for historical reference)

---

## 0. How to use this document

One row per milestone. Each row carries:

- **id** — stable identifier (`M-§X.Y-short-handle`)
- **falsifiable acceptance test** — the runnable assertion that gates "done"
- **capability_coverage target** — which key moves to which level (if any)
- **depends_on** — explicit DAG; never start before predecessors are done
- **instruction doc** — link to the `PR_*.md` spec, or `needs-spec` if missing
- **kill criterion** — per-milestone exit if the work isn't earning its complexity
- **status** — `done` (with commit) | `ready` | `blocked` | `needs-spec`

**Composer / Ralph rule:** no milestone is `done` until its falsifiable test runs green in CI (or, for live-only tests, under the documented opt-in flag with a recorded operator run). Mirror the existing v1 acceptance-gate discipline.

**Branch:** all work lands on `AMP` (current dev branch). Do not branch from `main`.

---

## 1. Current focus (Tracks 1 + 2)

> **What the user is doing right now:** closing implementation gaps and starting to dogfood AMP on real local projects. Headline benchmark and competitive-novelty checks are out of scope for this phase — see §3.

### Track 1 — Close remaining implementation gaps

The §11 wave (schema + upstream-sync + gstack + optimizer) and §10.4.1 (gbrain `graph_traversal`) are shipped. Two gbrain promotions and a handful of provisional surfaces remain.

| id | title | falsifiable test | capability target | depends_on | instruction doc | kill criterion | status |
|---|---|---|---|---|---|---|---|
| `M-§10.4.2-procedural-discovery` | gbrain skills discoverable via `amp procedural list --source gbrain --path <dir>` | `amp procedural list --source gbrain --path <fixture>` enumerates skills with validated frontmatter; invalid skills carry `validation_error`; registry + `from-amp/` untouched afterward | `procedural_registry: unsupported → wrapped` (gbrain) | none | `PR_10_4_2_GBRAIN_PROCEDURAL_REGISTRY_INSTRUCTION.md` | If reading the gbrain `skills/` dir directly proves brittle across gbrain versions, drop discovery overlay and stay `unsupported` | `ready` |
| `M-§10.4.3-vector-search-native` | gbrain `vector_search: native` proven by live test | `AMP_LIVE_GBRAIN=1 npx tsx --test src/amp/integration/gbrain-hybrid-live.test.ts` passes: score-descending, on-topic-first, semantic-recall non-keyword hit returned | `vector_search: wrapped → native` (gbrain) | none | `PR_10_4_3_GBRAIN_VECTOR_SEARCH_NATIVE_INSTRUCTION.md` | If live gbrain `query` ranking is non-deterministic against seeded frames, keep `wrapped` and document why | `ready` |
| `M-§4.2.3-priority-truncation` | Projection token-budget truncation honors the §4.2.3 drop-order (pending proposals → recent corrections → project details → active intent (preserved) → identity (preserved)) | Unit test: seed >2x-budget projection content; render; assert dropped sections match §4.2.3 priority order and that identity + active intent survive | none (projection-internal) | none | `needs-spec` (small PR; reference §4.2.3 of consolidated spec) | If priority-ordering doesn't reduce truncation harm vs current "soft warn → hard fail," keep current behavior | `needs-spec` |
| `M-§13.8-correction-lookup` | Correction lookup tables derived at consolidation, used by inference defaults | Capture N classifier-mismatch corrections for the same content shape; next similar capture is classified correctly without correction; round-trip is deterministic | none (substrate-internal) | none | `needs-spec` | If lookup-table impact on real corrections is < small N corrections / week, defer the feature and keep inference rule-based | `needs-spec` |
| `M-§13.7-pressure-test-v2-additions` | Adversarial five-attack review on v2 structural additions (3 substrate sub-layers, runtime/knowledge split, optimization sub-layer) | Documented review in `docs/reviews/AMP_V2_PRESSURE_TEST.md` covering each addition with at least one attack and a rebuttal or accepted defect | none | none | `needs-spec` | If no defects surface, mark the additions LOCKED and move on; this is a one-time review, not recurring work | `needs-spec` |
| `M-INV-3-cloud-bound-test` | INV-3 (cloud-bound vendor memory bounded) covered by at least one falsifiable test, or formally accepted as permanent vertical-slice deferral | Either a test exists that proves AMP refuses any path claiming to write vendor cloud memory, or `AMP_V1_ACCEPTANCE_REPORT.md` is updated to declare INV-3 permanently deferred with rationale | none | none | `needs-spec` | If cloud-bound write paths never become reachable (Shape B not built), keep deferred; do not invent a test for absent code | `needs-spec` |
| `M-GATE-DRIFT-graph-traversal-test` | Update tests that pin `graph_traversal: "unsupported"` so the §10.4.1 promotion to `wrapped` doesn't break the acceptance gate | `npm run amp:acceptance` passes; `doctor.test.ts` (current line 94) and `ssa/loader.test.ts` reflect the promoted capability | none | `needs-spec` (small test-only PR; reference commit `eaea475`) | If the SSA-driven capability assertions are too brittle, replace pinned values with `isCapabilitySupported`-style lookups | `ready` (regression discovered 2026-05-31 during `M-DOGFOOD-A-doctor-checklist` verification — pre-existing, not introduced) |
| `M-GATE-DRIFT-materialize-homedir` | Projection E2E leaks via upstream `changesets` writes against `~/.amp/` instead of the test-isolated path | `npm run amp:acceptance` passes from a clean homedir; `materialize.ts` resolves all upstream/projection paths through the same test-overridable base used by `agent-setup-local.test.ts` | none | `needs-spec` (small refactor + integration test guard) | If the homedir leak is a test-only fixture issue, gate the failing tests behind an explicit `AMP_USER_ROOT` and document the env requirement | `ready` (regression discovered 2026-05-31 during `M-DOGFOOD-A-doctor-checklist` verification — blocks acceptance gate today) |

### Track 2 — Dogfood readiness (Shape A end-to-end on a real local project)

Goal: T can pick a real local project on her Mac, run AMP against it, and observe the §2 value-prop tests #1, #3 (cross-surface visibility, corrections propagate) actually work — without writing new code.

| id | title | falsifiable test | depends_on | instruction doc | kill criterion | status |
|---|---|---|---|---|---|---|
| `M-DOGFOOD-A-walkthrough` | Step-by-step Shape A self-test doc grounded in the real CLI surface (`src/amp/cli/index.ts`) | A second operator following `docs/guides/AMP_SHAPE_A_DOGFOOD.md` reaches step 7 (cross-surface correction read) without code edits; every step carries a falsifiable assertion; PROVISIONAL steps are explicitly labeled | none | `docs/guides/AMP_SHAPE_A_DOGFOOD.md` | If the walkthrough cannot reach cross-surface read on local-only Shape A in one sitting, the substrate's local-first claim is undelivered — pause feature work, fix the gap | `done` (2026-05-31, T-authored, verified against `src/amp/cli/index.ts`) |
| `M-DOGFOOD-A-doctor-checklist` | `amp doctor` reports a single "dogfood-ready" line (pass/fail with reasons) | Fresh `amp init` followed by `amp doctor` returns a structured `dogfood_ready: true/false` block with checks for: gitignore, projection freshness, agent-setup wiring for Claude Code, capability gaps, runtime store reachable | `M-DOGFOOD-A-walkthrough` | inline (T-authored prompt 2026-05-31) | If checks bloat `amp doctor` output past usefulness, gate behind `--dogfood` flag | `done` (2026-05-31, files: `src/amp/cli/checks/dogfood-ready.ts` new, `doctor.ts` wired, `doctor.test.ts` 3/3 new tests green; rollup says "Steps 1–5 + Invariant 6 git repo" with Step 6 live-load explicitly PROVISIONAL; ~60% duplication with `agent-setup-status` + `gitignore-protection` flagged as follow-up debt — extract shared collectors next time) |
| `M-DOGFOOD-A-cross-surface-eval` | One recorded operator run of the §2 value-prop tests against AMP on T's machine | `docs/reviews/AMP_DOGFOOD_RUN_01.md`: capture a preference in Claude Code via projection, correct it via Claude Code, observe corrected value in Cursor's flattened MDC projection, log timestamps + diffs | `M-DOGFOOD-A-walkthrough`, `M-DOGFOOD-A-doctor-checklist` | `needs-spec` | If cross-surface read works in walkthrough but visibly fails on a real project, that's the §13.9 kill criterion firing — pause and reassess | `needs-spec` |
| `M-DOGFOOD-LIVE-GBRAIN-opt-in` | Operator run of the durable local capture → consolidate → retrieve loop against a live `gbrain serve` | Document a clean run of `AMP_LIVE_GBRAIN=1 AMP_KNOWLEDGE_BACKEND=gbrain amp consolidate` + retrieve on T's brain; record any orphan-page incidents (§6.3 transactions=unsupported risk) | none | `needs-spec` | If orphan pages appear in normal use, add a `amp doctor --reconcile` command before continuing | `needs-spec` |

### Track 3 — Hygiene (parallel-safe; can run alongside Tracks 1 + 2)

| id | title | falsifiable test | depends_on | instruction doc | status |
|---|---|---|---|---|---|
| `M-CONSOLIDATE-PLANS` | Mark `AMP_POST_V1_OPTIMIZER_UPSTREAM_PLAN.md` superseded by this roadmap; mark `AMP_V1_LAUNCH_BOARD.md` as historical | Both files carry a leading "Superseded by `docs/specs/AMP_ROADMAP.md` on 2026-05-31" banner; no other docs reference them as active | `M-GITIGNORE-ROADMAP-WHITELIST` | none | none | `blocked` (banner would point at an untracked file until whitelist lands) |
| `M-GITIGNORE-ROADMAP-WHITELIST` | Whitelist `docs/specs/AMP_ROADMAP.md` (and optionally `docs/guides/AMP_SHAPE_A_DOGFOOD.md`) so they ship as durable tracked records | `git check-ignore docs/specs/AMP_ROADMAP.md` returns empty; file appears in `git status --untracked-files=all` as a new tracked file | none | none | If the user wants the roadmap to stay operator-local, drop this milestone and replace the roadmap's "single source of truth" claim with "operator-local working doc" — see §7 honest-scope note added below | `ready` (one-line `.gitignore` edit; non-trivial only because both T-authored deliverables today are gitignored) |
| `M-SPEC-MERGE-v3` | Merge `AMP_SPEC_UPDATE_OPTIMIZER_AND_UPSTREAM_SYNC.md` into `AMP_CONSOLIDATED_SPEC.md` as v3 per delta §10 | Single canonical spec exists at v3; delta retained for history; cross-refs in code/docs updated | none | `needs-spec` | none | `needs-spec` |
| `M-CURSOR-MDC-NOTE` | Update §12.6 spike table: Cursor projection support landed via flattened MDC (not recursive `@filename`), spike no longer blocking. The recursive-`@` semantic itself remains **UNKNOWN/Not used** (per `AMP_SHAPE_A_DOGFOOD.md` honest-limitations table) — AMP simply doesn't depend on it | One-line spec edit; existing `cursor.test.ts` + `AMP_SHAPE_A_DOGFOOD.md` step 5 cited as the falsifiable proof | none | none | `ready` |

---

## 2. Open §13 questions still tracked as roadmap candidates

These are spec-level open questions that may or may not become milestones. They are kept here so they don't drop out of scope.

| Question | Source | Status here |
|---|---|---|
| §13.2 Procedural lifecycle (versioning, deprecation, conflict, deps) | consolidated spec | v2 candidate; not a current milestone |
| §13.3 Multi-device sync | consolidated spec | v2 candidate; single-device dogfooding first |
| §13.5 Multi-store federation | consolidated spec | v2 candidate; out of current focus |
| §13.6 Naming (AMP vs alternatives) | consolidated spec | Non-blocking; defer |
| §13.10 Optimizer edit-budget defaults | delta spec | Becomes a milestone once optimizer has correction-corpus data on T's machine (post Track 2) |
| §13.11 Upstream poll cadence default | delta spec | Becomes a milestone once a real upstream source (gstack on T's checkout) is running on a cadence |
| §13.12 Optimizer vs upstream conflict policy | delta spec | Decide after §13.10 data |
| §13.13 ActionLog future SSA verification | delta spec | Out of scope until a candidate SSA exists; `action_log: unsupported` everywhere today |

---

## 3. Future tracks (explicitly deferred — not current focus)

Recorded so they don't get lost. **Do not start these until Tracks 1 + 2 are done.**

### Track F1 — §13.9 capability benchmark (the headline experiment)

Convert the §13.9 vertical-slice kill criterion into a measured benchmark with numbers: propagation latency + task-success delta vs a no-AMP baseline on a small multi-surface task suite. Reproducible.

- **Why deferred:** premature without a smooth dogfood loop on T's machine. Run Track 2 first; that's the natural held-out task suite.
- **Falsifiable test (when started):** `npm run amp:benchmark` emits `benchmarks/amp/§13.9-continuity.json` with propagation_latency_ms and task_success_delta vs no-AMP baseline, n ≥ 10 per task category.
- **Kill criterion:** if task_success_delta ≤ 0 across all categories, the substrate is elegant infrastructure without a capability — keep the tool, drop the frontier framing.

### Track F2 — Competitive / literature verification

Independent check: does any shipping system already offer multi-backend memory portability with capability declaration? Run before pitching novelty externally.

- **Why deferred:** premature until Track F1 has numbers worth pitching.
- **Falsifiable test (when started):** `docs/reviews/AMP_COMPETITIVE_CHECK.md` lists ≥10 named memory systems (Mem0, Letta, Cognee, MemGPT, etc.) with a column for "substrate-over-backends + capability_coverage equivalent? yes/no/partial" and a recorded source per row.
- **Kill criterion:** if any system already ships the same shape, downgrade novelty claim from N2 (applied novel) to N3 (rigorous integration) and reframe accordingly.

### Track F3 — Shape B (remote MCP gateway)

§11.2 architectural commitment but no code. Unlocks claude.ai web and Cowork as integrated surfaces.

- **Why deferred:** Shape A must be smooth first; cloud surfaces add coverage but not foundational capability.
- **Falsifiable test (when started):** AMP-exposed remote MCP endpoint authenticated via OAuth answers `capabilities()` and survives one Cowork session.
- **Kill criterion:** if Shape A dogfood succeeds without users asking for cloud surfaces, leave Shape B as briefing-only.

### Track F4 — Shape C (briefing-only) CLI

Briefing generation for cloud surfaces (ChatGPT, claude.ai when not on Shape B).

- **Why deferred:** lower priority than Shape A dogfooding.
- **Falsifiable test (when started):** `amp briefing render --target chatgpt` emits a paste-ready handoff under context budget.
- **Kill criterion:** if briefings see < 1 use per week in real dogfooding, drop.

### Track F5 — Scheduler / daemon

§4.5 cron table lists Consolidation, Propagation, Health, Decay, Inference-training, Optimization, Upstream-sync. All currently invokable on-demand only; no real scheduler.

- **Why deferred:** on-demand is sufficient for single-user Shape A dogfooding. Daemon is the right next step *after* T has 30+ days of usage data to know which crons are worth running automatically.
- **Falsifiable test (when started):** `amp daemon start` runs all enabled crons quietly per §4.5 design rules (silent / idempotent / checkpoint-aware / quiet hours); `amp daemon status` reports last-run per cron.
- **Kill criterion:** if no cron's value justifies daemon overhead on T's laptop, keep on-demand permanently.

---

## 4. Instruction for Cursor / Composer — "test AMP today" handoff

Paste this as a Composer task to generate the missing `M-DOGFOOD-A-walkthrough` doc. It enforces the project's anti-overclaiming discipline.

> Read `src/amp/cli/index.ts` to confirm exactly which `amp` subcommands and flags exist (do not assume — `index.ts` is the registry). Then draft `docs/guides/AMP_SHAPE_A_DOGFOOD.md`: a step-by-step walkthrough to test AMP today on a real local project of T's, Shape A (local-only, §11.1), covering:
>
> 1. `amp init` in the project (note `.amp/local/` gitignore enforcement)
> 2. Capture a scoped preference (`amp capture --content "..." --scope project|user`)
> 3. Consolidate (`amp consolidate` — default local persistent knowledge.db, no `--knowledge gbrain` needed)
> 4. `amp projection render --source local --apply`
> 5. Wire the projection into a harness via `amp agent setup --target claude-code --apply` (VERIFIED — `agent-setup/claude-code.ts` ships; uses `CLAUDE.md` `@import` per §4.2.2) and `amp agent setup --target cursor --apply` (VERIFIED — `agent-setup/cursor.ts` ships flattened MDC; recursive `@filename` import in Cursor stays out of scope)
> 6. Open Claude Code and Cursor on the same project; confirm both see the preference in their respective AMP projection rendering
> 7. Cross-surface test: correct the fact via one surface (`amp runtime correct ...`), `amp projection render --source local --apply` again, confirm the other surface gets the corrected value (§2 value-prop #3)
>
> For every step:
> - Mark the step VERIFIED or PROVISIONAL against the offline acceptance scope (§9.8) and `AMP_V1_ACCEPTANCE_REPORT.md`.
> - Give one falsifiable success assertion (concrete observation, not "looks right").
> - Note what AMP cannot do today on this path (cloud surfaces = briefing-only and out-of-Shape-A; live gbrain = opt-in `AMP_LIVE_GBRAIN=1`, separate Track 2 milestone).
>
> Do not claim any propagation path that `injection_modes` / §9.8 doesn't support. End with the honest "what AMP cannot do today on Shape A" list, sourced from §9.8 and PROVISIONAL labels in `AMP_V1_ACCEPTANCE_REPORT.md`.

---

## 5. Verification matrix

Always run after substantive AMP changes:

```bash
npm run typecheck
npm run build
npx tsx --test                # node:test runner (not vitest)
npm run amp:acceptance        # v1 offline regression gate
```

Per-track additions:

| Track | Required verification |
|---|---|
| `M-§10.4.2` | Targeted node:test + fixture skills dir + capability assertion |
| `M-§10.4.3` | `AMP_LIVE_GBRAIN=1 npx tsx --test src/amp/integration/gbrain-hybrid-live.test.ts` + capability assertion |
| `M-§4.2.3` | Token-budget priority-truncation unit test |
| `M-§13.8` | Correction-lookup round-trip unit test |
| `M-§13.7` | Reviewed `docs/reviews/AMP_V2_PRESSURE_TEST.md` |
| Dogfood (M-DOGFOOD-A-*) | Operator run with recorded artifacts; no new tests required if walkthrough is grounded in existing acceptance-gated paths |

---

## 6. Guardrails (carry-forward from v1 + post-v1)

- v1 acceptance gate stays unchanged in policy and exit code unless a milestone explicitly promotes it.
- Live gbrain stays behind `AMP_LIVE_GBRAIN=1`; not part of default acceptance.
- Upstream apply is never automatic; high-risk requires `--confirm-breaking`.
- AMP-managed outputs live under `.amp/local/`, `~/.amp/`, or harness `from-amp/` only; gitignored; absent from `git status`.
- ActionLog stays `unsupported` everywhere; no ActiveGraph dependency.
- No milestone is `done` without its falsifiable test green.
- Validate every enum value, capability key, and schema field against `src/amp/**/schema*.ts` before naming it in spec or PR text.

---

## 7. Honest scope notes

Marked explicitly so the roadmap doesn't drift into aspirational territory:

- `M-§13.8`, `M-§4.2.3`, `M-DOGFOOD-A-*` are `needs-spec` — instruction docs to be drafted before Ralph/Composer touches them.
- All `live` tests are opt-in and run on T's machine, not CI; results land in `docs/reviews/` or `tools/cursor-sdk-amp-orchestrator/reports/`, not the acceptance gate.
- N2 (applied novel) framing for AMP rests on Track F2 (competitive verification). Until F2 runs, treat external novelty claims as PROVISIONAL.
- Cursor's flattened MDC approach replaces the §12.6 recursive `@filename` spike — note in `M-CURSOR-MDC-NOTE`.
- No production daemon exists; "crons" in the spec table are invokable functions today. This is fine for Shape A dogfooding and explicitly deferred to Track F5.
- **This roadmap file itself is currently gitignored** (`docs/specs/*` excludes everything not on the whitelist in `.gitignore`). Same for `docs/guides/AMP_SHAPE_A_DOGFOOD.md`. Until `M-GITIGNORE-ROADMAP-WHITELIST` lands, this is an operator-local working doc, not the durable tracked record its preamble claims. Decide explicitly: whitelist (durable) or accept operator-local status (and reword the preamble).
- `npm run amp:acceptance` does NOT currently pass on the working tree (2026-05-31). Two regressions — `M-GATE-DRIFT-graph-traversal-test` and `M-GATE-DRIFT-materialize-homedir` — discovered during `M-DOGFOOD-A-doctor-checklist` verification. The verification matrix in §5 assumes the gate is green; close those two before any milestone claims "all green."

---

*End of roadmap v1. Update in place; do not fork into a new document. Supersede entries by marking status `done <commit-sha>` or `dropped <reason>`.*
