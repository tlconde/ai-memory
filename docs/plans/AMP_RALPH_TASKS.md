# AMP Ralph Tasks

> **Branch:** `ralph/amp-vertical-slice`  
> **Prerequisite:** C1-C8 locked in `docs/plans/AMP_VERTICAL_SLICE_DECISIONS.md`  
> **Rule:** one task per commit; do not stage unrelated LongMemEval or local `.ai` changes.

## Preflight

```bash
git branch --show-current
git config core.hooksPath .githooks
npm run typecheck
```

Expected branch: `ralph/amp-vertical-slice`.

## Tasks

- [x] **T01 — AMP namespace scaffold**  
  Files: `src/amp/index.ts`, empty module dirs/barrels for `core`, `adapter-contract`, `substrate/storage`, `adapters`, `path-safety`, `conformance`.  
  Verify: `npm run typecheck`.  
  Commit: `feat(amp): scaffold vertical-slice module layout`.

- [x] **T02 — Frame schema + round-trip test**  
  Files: `src/amp/core/frame-schema.ts`, `src/amp/core/frame-schema.test.ts`.  
  Verify: `npm test -- src/amp/core/frame-schema.test.ts`.  
  Commit: `feat(amp): add frame schema with round-trip validation`.

- [x] **T03 — JSON-RPC error envelope**  
  Files: `src/amp/core/errors.ts`, `src/amp/core/errors.test.ts`.  
  Verify: `npm test -- src/amp/core/errors.test.ts`.  
  Commit: `feat(amp): add JSON-RPC 2.0 error codes`.

- [x] **T04 — Capability coverage parser**  
  Files: `src/amp/adapter-contract/capability-coverage.ts`, tests.  
  Verify: `npm test -- src/amp/adapter-contract/`.  
  Commit: `feat(amp): parse capability coverage blocks`.

- [x] **T05 — Runtime store**  
  Files: `src/amp/substrate/storage/runtime-store.ts`, tests using `mkdtemp`.  
  Verify: `npm test -- src/amp/substrate/storage/runtime-store`.  
  Commit: `feat(amp): add configurable runtime store`.

- [x] **T06 — Minimal knowledge store adapter**  
  Files: `src/amp/adapters/ssa/raw-fs/` or in-memory store, `ssa-files/raw-fs.yaml`.  
  Verify: `npm test -- src/amp/adapters/ssa/`.  
  Commit: `feat(amp): add minimal vertical-slice knowledge adapter`.

- [x] **T07 — Scope promotion gate**  
  Files: `src/amp/core/scope-gate.ts`, `src/amp/core/scope-gate.test.ts`.  
  Verify: `npm test -- src/amp/core/scope-gate.test.ts`.  
  Commit: `feat(amp): enforce scope-never-inferred-upward gate`.

- [x] **T08 — Runtime / knowledge isolation**  
  Files: `src/amp/substrate/storage/runtime-isolation.test.ts`.  
  Verify: `npm test -- src/amp/substrate/storage/runtime-isolation.test.ts`.  
  Commit: `test(amp): prove runtime state stays outside knowledge graph`.

- [x] **T09 — Minimal synchronous consolidation**  
  Files: `src/amp/substrate/storage/consolidation-minimal.ts`, tests.  
  Verify: `npm test -- src/amp/substrate/storage/consolidation`.  
  Commit: `feat(amp): add synchronous queue-to-knowledge consolidation`.

- [x] **T10 — `from-amp` path-safety module**  
  Files: `src/amp/path-safety/guard.ts`, tests for `..`, symlink escape, prefix mismatch.  
  Verify: `npm test -- src/amp/path-safety/`.  
  Commit: `feat(amp): add from-amp path safety guard`.

- [x] **T11 — Cursor SAS + adapter skeleton**  
  Files: `sas-files/cursor.yaml`, `src/amp/adapters/sas/cursor/adapter.ts`, tests.  
  Verify: `npm test -- src/amp/adapters/sas/cursor/`.  
  Commit: `feat(amp): add Cursor SAS and write guard skeleton`.

- [x] **T12 — Claude Code SAS + adapter skeleton**  
  Files: `sas-files/claude-code.yaml`, `src/amp/adapters/sas/claude-code/adapter.ts`, tests.  
  Verify: `npm test -- src/amp/adapters/sas/claude-code/`.  
  Commit: `feat(amp): add Claude Code SAS and write guard skeleton`.

- [x] **T13 — Capture + retrieval API**  
  Files: `src/amp/substrate/capture-preference.ts`, `src/amp/substrate/retrieve-preference.ts`, tests.  
  Verify: `npm test -- src/amp/substrate/capture` and retrieval tests.  
  Commit: `feat(amp): add preference capture and retrieval APIs`.

- [x] **T14 — E2E vertical slice integration test**  
  Files: `src/amp/integration/preference-vertical-slice.test.ts`.  
  Verify: `npm test -- src/amp/integration/preference-vertical-slice.test.ts`.  
  Commit: `test(amp): prove preference capture consolidate retrieve e2e`.

- [x] **T15 — Conformance invariant registry**  
  Files: `src/amp/conformance/invariant-registry.ts`, conformance tests mapping `INV-1` through `INV-5`.  
  Verify: `npm test -- src/amp/conformance/ && npm test -- src/amp/`.  
  Commit: `test(amp): register conformance IDs for five invariants`.

## Full Slice Done When

- `npm run typecheck` passes.
- `npm test -- src/amp/` passes.
- All acceptance checks in `docs/plans/AMP_VERTICAL_SLICE_GOAL.md` have automated coverage.
- No tests or adapters write outside declared `from-amp` roots.
- No task introduces gbrain MCP, remote MCP, Codex/Gemini/Windsurf adapters, profile slots, model fine-tuning, or unrelated benchmark changes.

## Process Note (post T01–T15)

Tasks T01–T15 were completed by Composer in batched commits rather than strict one-commit-per-task Ralph loops. **Do not rewrite that history** unless explicitly instructed.

From this point forward, fix work and evaluator findings must return to **one commit per finding**. Do not mark new work as checked until `npm run typecheck`, `npm run build`, and the relevant `npm test -- src/amp/` suites pass.
