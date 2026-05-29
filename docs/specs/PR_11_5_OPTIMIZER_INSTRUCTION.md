# PR §11.5 — Optimization sub-layer (Eval / Judge / Optimizer / ValidationGate)

> **Status:** implementation instruction. Build on branch `AMP`.
> **Spec:** `docs/specs/AMP_SPEC_UPDATE_OPTIMIZER_AND_UPSTREAM_SYNC.md` §2, §4.3.5, §4.5, §2.5 (falsifiable), §13.10 (PROVISIONAL budget defaults).
> **Date:** 2026-05-29

## Goal

Add the substrate's fifth sub-layer (§4.3.5) — offline, deterministic skill optimization. The gstack corpus from §11.4 feeds the falsifiable test (§2.5). This is the last spec build step before the remaining gbrain promotions (§10.4.2 / §10.4.3).

## Scout findings (build on these — verified 2026-05-29)

- **No** `Eval` / `Judge` / `Optimizer` / `ValidationGate` / `EditBudget` exist anywhere under `src/amp` (only the unrelated `EvaluateProjectionBudget*` token-budgeting). Build new under `src/amp/substrate/optimization/`, sibling to `inference/` `consolidation/` `propagation/` per §4.3.5.
- Corrections are **not** a `CorrectionCorpus` type — they persist as `episodic-frame` rows with `event_type: "correction"` (`runtime-semantics/capture-correction.ts:49`; episodic schema `runtime-semantics/schema.ts:364`). Source the corpus by querying those rows for the target skill.
- Mirror the existing **plan/apply purity split**:
  - `planRuntimeGraduation()` (`runtime-semantics/graduation-planner.ts:609`) is **pure, no writes**, returns decisions + summary → model `Optimizer.propose()` the same way (returns a `ProposedEdit`, writes nothing).
  - `applyRuntimeGraduationDecision()` (`runtime-semantics/graduation-apply.ts:82`) is the commit path → model the optimizer's accept step on it.
- `ProcedureRegistry.update(name, procedure)` (`procedural/registry.ts:66`) is **caller-version-managed** — the optimizer bumps `version` X.Y.Z → X.Y.(Z+1) itself (§2.3 step 6b) before calling `update`.
- Procedure `provenance` / `version` / `conflicts` already exist (`procedural/schema.ts`); set provenance on accept per §2.3 (`source: "amp-registry"`, `author: "amp-optimizer"`, notes = cycle/scoreDelta/budget).
- `skill_optimization` capability key exists (`adapter-contract/capability-coverage.ts:30`); in-memory and gbrain both `"unsupported"`. **This PR flips in-memory → `"wrapped"`** and ships a deterministic rule-based optimizer there (§2.4). gbrain stays `unsupported` until it ships its own loop.

## Build

`src/amp/substrate/optimization/`:

1. `types.ts` — the four interfaces (§2.1) plus `EvalInput` / `EvalExpected` / `EvalScore`, `JudgeVerdict`, `ExecutionTrace`, `ProposedEdit` (unified diff), `EditBudget`, `ValidationResult`, `CorrectionCorpusEntry`. Strict zod where serialized.
2. `edit-budget.ts` — enforce §2.2: `max_lines_changed: 15`, `max_chars_changed: 600`, `preserve_sections` (e.g. `## Triggers`, `## Falsifiable claim`), `max_frontmatter_keys_changed: 3`. Defaults PROVISIONAL (§13.10) — configurable. Reject any diff exceeding budget or touching a preserved section.
3. `eval.ts` — deterministic qrels-style `Eval` (LLM-free).
4. `judge.ts` — `Judge` interface + a deterministic rule-based stub for CI (no real LLM).
5. `optimizer.ts` — rule-based `Optimizer.propose(current, corpus, judgments, budget): ProposedEdit`. **Pure, no writes** (mirror `planRuntimeGraduation`).
6. `validation-gate.ts` — `ValidationGate.validate(before, after, holdout)`: accept **only if** the holdout score *strictly* improves AND the edit budget is respected; a reject carries `reject_reason`.
7. `loop.ts` — `runOptimizationCycle(skillName, …)` implementing §2.3 steps 3–7: drain corrections for the skill → `Eval`/`Judge` score recent runs → if below threshold `Optimizer.propose` → `ValidationGate.validate` against holdout → on accept: bump version, set provenance, `registry.update()`, `propagateProcedures()`, write `skill_optimized` audit frame; on reject: write a rejected-proposal audit frame, no registry write. Silent when no corrections (§4.5 cron rules: silent / idempotent / checkpoint-aware / quiet hours).
8. Audit: add `event_type: "skill_optimized"` and `"skill_optimization_rejected"` to `EpisodicEventTypeSchema` — **an event_type, not a new top-level entity kind** (same pattern as `upstream_applied`; verify against `runtime-semantics/schema.ts` before adding).
9. CLI: `amp optimize {run,dry-run}` (or `amp cron optimization`). Flip `skill_optimization: unsupported → wrapped` in the in-memory / raw-fs coverage defaults; gbrain stays `unsupported`.

## Tests (node:test runner)

- `src/amp/integration/optimizer-vertical-slice.test.ts` — §2.5 falsifiable: a known-buggy `SKILL.md` + a holdout corpus encoding the correct behavior as qrels → the loop converges within N cycles to a `SKILL.md` that scores strictly higher on the holdout; a rejected proposal's `reject_reason` round-trips the audit log.
- Unit: edit-budget rejects over-budget and preserved-section diffs; validation-gate rejects non-improving proposals; `optimizer.propose` stays within budget and writes nothing.
- §4.5 claim: `amp optimize --dry-run` on a fresh install with no correction corpus → 0 proposed edits, exits 0 in < 1s, silent unless `--verbose`.

## Constraints

- Offline + deterministic. `Judge` is an interface; in-memory ships a rule-based judge — **no real LLM in CI**.
- Reuse `registry.update`, `propagateProcedures`, the episodic audit writer, and the plan/apply purity pattern. Do not duplicate.
- Do **not** touch `AmpConfigFileSchema`.
- node:test runner (`npx tsx --test`). Anything constructing `RuntimeStore` (better-sqlite3) won't run on a Linux CI without `npm rebuild better-sqlite3` — gate or rebuild.

## Out of scope (§2.6)

Per-user fine-tuned optimizer models; cross-skill co-optimization; online / between-turn optimization (v1.5 is offline batch only).

## Commit split

1. `types.ts` + `edit-budget.ts` + capability flip (in-memory `skill_optimization: wrapped`).
2. `eval.ts` + `judge.ts` (stub) + `optimizer.ts`.
3. `validation-gate.ts` + `loop.ts` + audit `event_type` additions.
4. CLI verbs + §2.5 vertical-slice fixture test.
