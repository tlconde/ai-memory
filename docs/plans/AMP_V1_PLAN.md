# AMP v1 Plan

> **Base branch:** `ralph/amp-v1-v1-30` (Wave 2 complete)
> **Target integration branch:** `ralph/amp-v1`  
> **Role split:** Composer/Ralph implement; Codex evaluates and gates merges.  
> **Status:** offline acceptance gate and V1-31 docs update complete; post-v1 live verification wave in progress (see reports dir).

## v1 Goal

AMP v1 is accepted when a local `ai-memory` checkout passes the deterministic offline acceptance gate without unsafe file writes, hidden scope promotion, or unverifiable adapter claims.

The v1 proof:

> Capture a scoped preference or correction, queue it in runtime, consolidate it into fake-gbrain-backed or in-memory knowledge, retrieve it through the substrate API used by local harness adapters, and compile one canonical AMP procedure into harness-native `from-amp/` artifacts with path-safety and provenance preserved.

## Current State

Wave 2 implementation is complete through V1-30. The offline acceptance gate passes:

- **CLI:** `amp init`, `amp doctor`, `amp capture`, `amp consolidate`, `amp retrieve`, `amp propagate`.
- **Canonical gate:** `npm run amp:acceptance` (entry: `src/amp/conformance/run-acceptance-gate.mjs`) passes at commit `82962bf`.
- **E2E (offline):** fake-gbrain retrieval tests pass; procedure propagation E2E passes with filesystem readback under `from-amp/`.
- **Conformance:** runner passes with only **INV-3** deferred (cloud/vendor memory out of v1 scope).
- **Path safety:** AMP-managed harness writes resolve inside `from-amp/` only.
- **gbrain backend:** live gbrain is the CLI default; fake-gbrain is explicit test mode.

Full verification also passes: `npm run typecheck`, `npm run build`, and `npm test`.

## Is AMP Ready Today?

**For offline v1 acceptance: yes.** `npm run amp:acceptance` passes and proves the deterministic, offline v1 proof loop.

**For live production claims: partially.** Several behaviors are verified only at filesystem or fake-gbrain level, not through live harness session discovery or live gbrain serve. The canonical acceptance record is `docs/plans/AMP_V1_ACCEPTANCE_REPORT.md`.

What is verified today:

- Config discovery, SSA/SAS loaders, adapter contract, conformance runner, correction frames, shared curation guardrails.
- gbrain SSA adapter with fake-gbrain E2E and honest capability coverage.
- Hermes, Cursor, and Claude Code filesystem adapters with path-safety suites.
- Canonical procedure registry, compilers, propagation service, and filesystem readback E2E.
- CLI init/doctor/capture/consolidate/retrieve/propagate with smoke checks in the acceptance gate.

What remains outside v1 acceptance is tracked in `docs/plans/AMP_V1_ACCEPTANCE_REPORT.md`.

## Post-v1 live verification wave

Offline acceptance (`npm run amp:acceptance`) is complete at commit `82962bf`. **Live verification is a separate wave** — it does not modify the acceptance gate or its exit codes.

Live spike reports are recorded under `tools/cursor-sdk-amp-orchestrator/reports/`:

- `amp-gbrain-live.md` — live `gbrain serve` MCP transport
- `amp-hermes-live.md` — live Hermes session/skill discovery

Consult that directory if individual report files are not yet published. Canonical offline scope, PROVISIONAL/UNKNOWN exclusions, and residual risks remain in `docs/plans/AMP_V1_ACCEPTANCE_REPORT.md`.

## v1 Scope

In scope:

- Shape A local-only deployment.
- gbrain as the reference knowledge backend.
- Hermes, Cursor, and Claude Code as verified **offline** filesystem harness adapters (emit/readback in tests); live session discovery remains PROVISIONAL/UNKNOWN.
- Canonical AMP procedure source compiled into harness-native artifacts.
- Runtime store with configurable path and local project config.
- Deterministic v1 feedback loop using correction frames and rule/lookup overrides, not model fine-tuning.
- Conformance tests tied to invariant IDs.
- CLI-driven install, doctor, capture, consolidate, retrieve, and propagate workflows.

Out of scope:

- Remote MCP gateway and cloud surfaces.
- ChatGPT/claude.ai memory writes.
- Codex, Gemini, Windsurf, Antigravity adapters unless exact placement and load behavior are directly verified.
- Multi-device sync.
- Multi-store federation.
- Model fine-tuning.
- Bulk shared-curation operations.

## Architecture Commitments

- The four substrate sub-layers remain implementation modules, not protocol-visible types: storage, inference, consolidation, propagation.
- Runtime-internal state remains outside the knowledge graph and never receives `curation_mode`.
- Knowledge frames keep exactly three kinds in v1: `episodic`, `semantic`, `crystal`.
- `curation_mode` values remain `personal`, `llm_curated`, and `shared`.
- Profile slots remain typed saved queries over frames, graph, and runtime.
- AMP-managed harness writes always resolve inside `from-amp/`.
- Procedures use a compiler model: canonical AMP source is the input; Cursor `.mdc`, Claude Code `SKILL.md`, and Hermes artifacts are emitted outputs.
- External tool behavior is adapter-verifiable, not assumed from ecosystem convergence.

## v1 Milestones

### M0 — Integration Baseline — **Complete**

Created `ralph/amp-v1` from the verified vertical slice. Baseline green: `npm run typecheck`, `npm run build`, and `npm test`.

### M1 — Contracts Hardened — **Complete**

Config shape, adapter contract, SSA/SAS loader behavior, capability coverage semantics, and conformance IDs locked (V1-01 through V1-06).

### M2 — Real Storage — **Complete (offline)**

gbrain SSA adapter implemented with fake-gbrain E2E parity and honest unsupported-capability reporting (V1-07 through V1-11). Live transport exclusions are tracked in the acceptance report.

### M3 — Real Harnesses — **Complete (filesystem)**

Cursor, Claude Code, and Hermes filesystem adapters pass conformance and path-safety suites (V1-12 through V1-16). Live harness session exclusions are tracked in the acceptance report.

### M4 — Procedure Compiler and Propagation — **Complete**

Canonical AMP procedure registry, compilers, and propagation service emit harness-native artifacts into `from-amp/` roots only (V1-17 through V1-21).

### M5 — CLI and Installability — **Complete**

User-facing commands: `amp init`, `amp doctor`, `amp capture`, `amp consolidate`, `amp retrieve`, `amp propagate` (V1-22 through V1-26).

### M6 — End-to-End v1 Proof — **Complete (offline acceptance)**

Acceptance gate passes at commit `82962bf`:

1. Initialize AMP in a fixture project.
2. Capture a scoped preference or correction.
3. Consolidate into fake-gbrain-backed knowledge.
4. Retrieve via verified harness adapter (filesystem-level readback).
5. Compile a canonical procedure into `from-amp/`.
6. Run conformance and safety tests via `npm run amp:acceptance`.

## Acceptance Gates

**Canonical gate:** `npm run amp:acceptance` — see `docs/plans/AMP_V1_ACCEPTANCE_REPORT.md` (gate commit `82962bf`).

The acceptance report is the human-readable source of truth for gate steps, invariant policy, PROVISIONAL/UNKNOWN exclusions, and residual risks. The executable source of truth is `src/amp/conformance/acceptance-gate.ts`.

## Kill Criteria

Pause and reassess if any of these happen:

- ~~After two focused implementation weeks, gbrain-backed capture/consolidate/retrieve still cannot pass.~~ **Resolved:** offline fake-gbrain path passes acceptance.
- A real harness integration requires writing outside `from-amp/`.
- The CLI cannot explain capability gaps clearly enough for a user to act.
- The adapter contract needs incompatible changes in more than two independent lanes.
- v1 requires remote/cloud infrastructure to demonstrate value.

## Evaluator Rules

Codex evaluates, Composer/Ralph implement:

- Do not accept a Composer report as implementation evidence.
- Do not merge a Ralph task without a passing verification command recorded in the task.
- Prefer one commit per task. If a worker batches tasks, require a report explaining why and verify all touched lanes.
- If a task changes shared contracts, stop parallel work until dependent lanes rebase.
- Never stage `.ai/`, `.cursor/`, `.claude/`, `AGENTS.md`, local Composer manifests, or generated secret-bearing logs.
