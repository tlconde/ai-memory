# AMP v1 Orchestration

> **Purpose:** Give Cursor Composer 2.5 and Ralph loops enough structure to work in parallel while Codex stays evaluator-only.

## Operating Model

Codex is the orchestrator/evaluator:

- Locks contracts and task boundaries.
- Assigns independent lanes.
- Reviews Composer and Ralph reports.
- Runs verification.
- Blocks merges on invariant drift.

Cursor Composer 2.5 is the implementation planner and code worker:

- Reads the v1 docs.
- Produces bounded implementation diffs or reports.
- Does not silently broaden scope.
- Labels external claims as `VERIFIED`, `PROVISIONAL`, or `UNKNOWN`.

Ralph loops are atomic execution workers:

- One task, one branch/worktree, one commit.
- No cross-lane edits unless the task explicitly owns a shared contract.
- Stop on failing tests.
- Report files touched, commands run, and residual risk.

## Branch Layout

Create an integration branch from the verified vertical slice:

```bash
git switch ralph/amp-vertical-slice
git switch -c ralph/amp-v1
```

Parallel lanes should branch from `ralph/amp-v1`:

| Lane | Branch | Owns |
|---|---|---|
| Contracts | `ralph/amp-v1-contracts` | config, SSA/SAS loaders, adapter contract, conformance IDs |
| Storage | `ralph/amp-v1-gbrain` | gbrain SSA, storage conformance |
| Harness | `ralph/amp-v1-harnesses` | Hermes, Cursor, Claude Code adapter behavior |
| Procedures | `ralph/amp-v1-procedures` | canonical procedure registry, compiler, propagation |
| CLI | `ralph/amp-v1-cli` | `amp` commands, config discovery, doctor |
| E2E | `ralph/amp-v1-e2e` | fixtures, v1 integration tests, acceptance script |
| Docs | `ralph/amp-v1-docs` | docs updates from verified implementation only |

Do not run two lanes that edit the same shared contract at the same time. Contracts lane is the first barrier.

## Barriers

### Barrier 0 — Baseline

Must pass before any v1 task:

```bash
npm run typecheck
npm run build
npm test
```

### Barrier 1 — Contract Freeze

Tasks V1-01 through V1-06 are complete and merged. No storage, harness, procedure, or CLI lane starts before this unless it works against a local stub and declares rebase risk.

### Barrier 2 — Adapter Proofs

At least one real storage adapter and one real harness adapter pass conformance. Procedure propagation can emit files, but E2E cannot claim v1 until this barrier passes.

### Barrier 3 — Installability

CLI init/doctor/capture/consolidate/retrieve/propagate are implemented. E2E lane proves a fixture project can opt in without editing source internals.

### Barrier 4 — v1 Release Candidate

All acceptance gates in `docs/plans/AMP_V1_PLAN.md` pass. Codex performs final review and only then marks v1 ready.

## Parallelization Strategy

After Barrier 1:

- Storage lane and Harness lane can run in parallel because they meet at the adapter contract.
- Procedures lane can start once path-safety and config roots are frozen.
- CLI lane can start after config and command names are frozen, using fake adapters until real ones land.
- E2E lane writes fixtures early but marks tests skipped or pending until real adapters land.
- Docs lane only updates after code behavior is verified.

## Composer Prompt Routing

Use `docs/plans/AMP_V1_COMPOSER_PROMPT.md` as the master prompt. For a lane-specific Composer session, append exactly one task block from `docs/plans/AMP_V1_TASKS.md`.

Composer must produce:

- Summary of files changed.
- Verification commands and outputs.
- External claims with labels.
- Known residual risks.
- Suggested commit message.

## Ralph Loop Contract

Every Ralph task must include:

- Task ID.
- Owned files.
- Forbidden files.
- Verification command.
- Commit message.
- Stop condition.

Ralph must stop immediately if:

- Tests fail.
- The task needs a contract not yet frozen.
- It needs network or real local service access not declared by the task.
- It would write outside `from-amp/`.
- It would alter `.ai/`, `.cursor/`, `.claude/`, or unrelated benchmark files.

## Evaluator Checklist

For every task report:

- Did it stay inside owned files?
- Did it preserve all AMP invariants?
- Did it add or update falsifiable tests?
- Did it avoid unverifiable external claims?
- Did it keep runtime state out of knowledge frames?
- Did it maintain the compiler model for procedures?
- Did it declare capability gaps honestly?
- Did it run the requested commands?

If any answer is no, return the task to Composer/Ralph with the smallest failing repro.

