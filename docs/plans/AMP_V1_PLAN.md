# AMP v1 Plan

> **Base branch:** `ralph/amp-vertical-slice`  
> **Target integration branch:** `ralph/amp-v1`  
> **Role split:** Composer/Ralph implement; Codex evaluates and gates merges.  
> **Status:** implementation plan after the vertical-slice proof.

## v1 Goal

AMP v1 is ready when a local `ai-memory` install can connect the AMP substrate to the user's local gbrain-backed memory and at least one real harness beyond tests, without unsafe file writes, hidden scope promotion, or unverifiable adapter claims.

The v1 proof:

> Capture a scoped preference or correction from one local surface, queue it in runtime, consolidate it into gbrain-backed knowledge, retrieve it through Hermes or another verified local harness adapter, and compile one canonical AMP procedure into harness-native `from-amp/` artifacts with path-safety and provenance preserved.

## Current State

The vertical slice is done:

- Frame schema, AMP error envelope, scope gate, capability coverage, runtime store, in-memory knowledge adapter, minimal consolidation, path-safety guard, Cursor/Claude Code adapter skeletons, capture/retrieve APIs, and E2E tests exist under `src/amp/`.
- Full verification has passed previously: `npm run typecheck`, `npm run build`, and `npm test`.
- The current slice does **not** prove gbrain, Hermes, live harness loading, propagation, or installability in another project.

## Is AMP Ready Today?

No. It is a tested vertical slice, not installable AMP v1.

If installed in another project today, AMP will not automatically start working with gbrain and Hermes because these pieces are still missing:

- A real gbrain SSA adapter with verified transport and capability coverage.
- A Hermes SAS adapter with verified local paths, read/write behavior, and conformance tests.
- A production CLI surface (`amp init`, `amp doctor`, `amp capture`, `amp consolidate`, `amp retrieve`, `amp propagate`).
- Config discovery for per-project and per-user AMP settings.
- A canonical procedure registry and compiler that emits Cursor `.mdc` and Claude/Hermes `SKILL.md` artifacts from one AMP source.
- Live adapter load tests proving emitted artifacts are seen by the harnesses.
- Installer/package wiring so another project can opt into AMP without hand-editing internals.

## v1 Scope

In scope:

- Shape A local-only deployment.
- gbrain as the reference knowledge backend.
- Hermes, Cursor, and Claude Code as verified local harnesses if each passes direct placement/load tests.
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

### M0 — Integration Baseline

Create `ralph/amp-v1` from the verified vertical slice. Re-run `npm run typecheck`, `npm run build`, and `npm test`. No implementation lane starts unless the baseline is green.

### M1 — Contracts Hardened

Lock config shape, adapter contract, SSA/SAS loader behavior, capability coverage semantics, and conformance IDs. This milestone prevents parallel workers from inventing incompatible contracts.

### M2 — Real Storage

Implement and verify gbrain as the reference SSA. The first backend can be wrapped if needed, but unsupported capabilities must be declared honestly.

### M3 — Real Harnesses

Promote Cursor and Claude Code adapters from skeletons to real compiler targets. Add Hermes once its path and behavior are directly verified in this repo.

### M4 — Procedure Compiler and Propagation

Implement canonical AMP procedure registry and emit harness-native artifacts into `from-amp/` roots only. Add conflict detection and provenance metadata.

### M5 — CLI and Installability

Add user-facing commands for init, doctor, capture, consolidate, retrieve, and propagate. Another project should be able to opt in without editing source files.

### M6 — End-to-End v1 Proof

Run a real local flow with gbrain and at least one verified harness adapter:

1. Initialize AMP in a fixture project.
2. Capture a scoped preference or correction.
3. Consolidate into gbrain-backed knowledge.
4. Retrieve from another verified local harness path.
5. Compile a canonical procedure into `from-amp/`.
6. Run conformance and safety tests.

## Acceptance Gates

AMP v1 is complete only when all gates pass:

- `npm run typecheck`
- `npm run build`
- `npm test`
- `npm test -- src/amp/`
- gbrain adapter conformance suite passes against a local test instance or documented fake server with parity checks.
- Hermes adapter conformance suite passes after direct path/load verification.
- Cursor and Claude Code adapter path-safety suites include ancestor symlink, missing root, nested write, direct root write, and prefix-confusion cases.
- Procedure compiler emits deterministic artifacts and never mutates user-authored files.
- `amp doctor` reports capability gaps instead of hiding them.
- A new fixture project can run `amp init`, capture, consolidate, retrieve, and propagate with no manual source edits.

## Kill Criteria

Pause and reassess if any of these happen:

- After two focused implementation weeks, gbrain-backed capture/consolidate/retrieve still cannot pass.
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

