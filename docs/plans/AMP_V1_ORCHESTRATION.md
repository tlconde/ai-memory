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

Wave 2 complete at `ralph/amp-v1-v1-30` (commit `82962bf`). Task branches follow:

```bash
git switch ralph/amp-v1-v1-30
git switch -c ralph/amp-v1-v1-XX   # one task per branch/commit
```

Historical integration branch: `ralph/amp-v1` (from vertical slice). Current task-branch base: `ralph/amp-v1-v1-30`.

| Lane | Branch pattern | Owns |
|---|---|---|
| Contracts | `ralph/amp-v1-v1-01` … `v1-06` | config, SSA/SAS loaders, adapter contract, conformance IDs |
| Storage | `ralph/amp-v1-v1-07` … `v1-11` | gbrain SSA, storage conformance |
| Harness | `ralph/amp-v1-v1-12` … `v1-16` | Hermes, Cursor, Claude Code adapter behavior |
| Procedures | `ralph/amp-v1-v1-17` … `v1-21` | canonical procedure registry, compiler, propagation |
| CLI | `ralph/amp-v1-v1-22` … `v1-26` | `amp` commands, config discovery, doctor |
| E2E | `ralph/amp-v1-v1-27` … `v1-30` | fixtures, v1 integration tests, acceptance gate |
| Docs | `ralph/amp-v1-v1-31` | docs updates from verified implementation only |

Do not run two lanes that edit the same shared contract at the same time. Contracts lane was the first barrier.

## Barriers

### Barrier 0 — Baseline — **Passed**

Must pass before any v1 task:

```bash
npm run typecheck
npm run build
npm test
```

### Barrier 1 — Contract Freeze — **Passed**

Tasks V1-01 through V1-06 are complete and merged.

### Barrier 2 — Adapter Proofs — **Passed (offline)**

Storage and harness adapters pass conformance with fake-gbrain and filesystem-level harness readback. Live gbrain serve and live harness session loading remain PROVISIONAL/UNKNOWN.

### Barrier 3 — Installability — **Passed**

CLI init/doctor/capture/consolidate/retrieve/propagate are implemented. E2E fixture proves opt-in without editing source internals.

### Barrier 4 — v1 Release Candidate — **Passed**

`npm run amp:acceptance` passes at commit `82962bf`.

Full step output, invariant policy, PROVISIONAL/UNKNOWN exclusions, and residual risks are recorded in `docs/plans/AMP_V1_ACCEPTANCE_REPORT.md`.

Codex performs final review on V1-31 docs before marking v1 documentation complete.

## Parallelization Strategy

After Barrier 1:

- Storage lane and Harness lane can run in parallel because they meet at the adapter contract.
- Procedures lane can start once path-safety and config roots are frozen.
- CLI lane can start after config and command names are frozen, using fake adapters until real ones land.
- E2E lane writes fixtures early but marks tests skipped or pending until real adapters land.
- Docs lane only updates after code behavior is verified.

**Current state:** implementation lanes complete through V1-30. Docs lane (V1-31) is complete.

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

For release-candidate tasks (V1-27 through V1-31), did `npm run amp:acceptance` pass?

If any answer is no, return the task to Composer/Ralph with the smallest failing repro.
