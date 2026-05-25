# AMP v1 Acceptance Gate — Offline/Deterministic Audit

**Task:** V1-LIVE-04  
**Branch:** `ralph/amp-v1-live-04` @ `75cc4c5`  
**Auditor:** SUBAGENT D  
**Date:** 2026-05-25  

## Verdict

**The acceptance gate is deterministic and offline.** No live-service assumptions are embedded in the gate runner, conformance runner, or CLI entry. Live gbrain, Hermes, and harness session checks are explicitly excluded via `AMP_V1_PROVISIONAL_DISCLAIMER` and are not invoked by `npm run amp:acceptance`.

## Scope Reviewed

| File | Role |
|------|------|
| `src/amp/conformance/acceptance-gate.ts` | Gate orchestration, policy evaluation, CLI smoke |
| `src/amp/conformance/run-acceptance-gate.mjs` | CLI entry; maps gate result to process exit |
| `src/amp/conformance/conformance-runner.ts` | Invariant → test-file mapping and local test execution |
| `src/amp/conformance/invariant-registry.ts` | INV-1..5 test mappings; INV-3 deferred (empty testFiles) |
| `src/amp/conformance/acceptance-gate.test.ts` | Unit tests for policy, early-exit, PROVISIONAL disclaimer |
| `package.json` | `amp:acceptance` script wiring only |

## Gate Pipeline (offline steps only)

1. **typecheck** — `npm run typecheck` (local `tsc --noEmit`)
2. **build** — `npm run build` (local `tsc`)
3. **test** — `npm run test` (local `node --test` over `src/**/*.test.ts`)
4. **conformance** — `runConformance()` executes mapped test files via `defaultExecuteTests` (local spawn, no network)
5. **CLI smoke** (only if conformance policy passes):
   - `amp --help`, `amp status`, `amp init`, `amp doctor` via `spawnSync` + temp dir

All subprocess calls use `spawnSync` / `spawn` with `process.env` unchanged — **no network isolation flag is set**, but **no gate step invokes HTTP, MCP stdio to live services, or external APIs**.

## Live-Service Assumption Check

| Concern | Finding |
|---------|---------|
| Live gbrain serve | **Not called.** INV-3 is registry-deferred (`testFiles: []`). gbrain conformance uses `FakeGbrainMcpTransport` only. |
| Live Hermes / Cursor / Claude Code sessions | **Not called.** Gate runs local CLI smoke and file-based adapter tests. PROVISIONAL disclaimer lists these as out-of-scope. |
| Network fetch / HTTP | **Not in gate or conformance runner.** Mapped conformance tests exercise in-memory/fake transports and local filesystem fixtures. |
| Cloud vendor memory (INV-3) | **Explicitly deferred** — acceptance policy allows only INV-3 deferral; any other deferred invariant fails the gate (`conformanceMeetsAcceptancePolicy`). |

## Exit Semantics on Failure

| Layer | Behavior |
|-------|----------|
| `evaluateAcceptanceGate()` | Returns `false` when any step fails or conformance policy violated |
| `mainAcceptanceGate()` | Returns `0` on pass, `1` on fail |
| `run-acceptance-gate.mjs` | `process.exit(exitCode)` — **nonzero exit on failure** |
| Early abort | If typecheck/build/test fails, conformance and CLI smoke are skipped; report still returns `allPassed: false` |

Unit test `acceptance-gate.test.ts` confirms early-exit skips conformance when a build step fails.

## Acceptance Policy Highlights

- Conformance `allPassed` treats `pass` and `deferred` as OK at runner level.
- Gate policy (`conformanceMeetsAcceptancePolicy`) is stricter: **only INV-3 may be deferred**; all other invariants must `pass`.
- Non-INV-3 deferrals fail the conformance step even when runner reports `Overall: PASS`.

## Code Changes

**None required.** Existing comments, tests, and PROVISIONAL disclaimer already document offline guarantees. This audit is report-only.

## Verification Results

Run from worktree root with full permissions (sandbox EPERM on `.cursor` symlinks/fixtures otherwise):

```
node --import tsx --test src/amp/conformance/*.test.ts
# 28 pass, 0 fail — exit 0

npm run amp:acceptance
# PASS typecheck, build, test, conformance, cli smoke
# === AMP v1 ACCEPTANCE: PASS === — exit 0
```

Note: `npm test -- src/amp/conformance/` still runs the full suite per `package.json` glob; use explicit conformance glob for scoped runs.

## Ready for Codex

**Yes** — gate is offline/deterministic, failure exits nonzero, and verification passes at `75cc4c5` baseline with no code changes needed.
