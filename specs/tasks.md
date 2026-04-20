# Tasks: Chunk-level retrieval refactor

One task per commit. Verification command must pass before checking the box.

- [ ] **T1 — API design critique.** Independent review of `specs/plan.md` API shape: find gaps, missed edge cases, naming issues. Verify: reviewer report appended to `LEARNINGS.md`.
- [ ] **T2 — Consumer audit.** Map every call site of `hybridSearch`, `loadChunks`, and the `Chunk`/`SearchResult` types. Document expected behavior per consumer. Verify: audit report appended to `LEARNINGS.md`.
- [ ] **T3 — Test harness prep.** Identify or set up the project test runner. Write (failing) tests for the new `rankChunks` API and the regression guards for `hybridSearch`. Verify: `npm test` runs and shows the expected failures.
- [ ] **T4 — Refactor internals.** Implement `Chunk.id`, rewrite `keywordSearchChunks` / `semanticSearchChunks` / `rrfMerge` to chunk granularity. Do not yet expose `rankChunks`. Verify: existing tests + build pass (product path should still work because `hybridSearch` internals changed but output shape is the same after re-adding file-dedupe in step T5).
- [ ] **T5 — Expose `rankChunks` and rewire `hybridSearch`.** Add the public API; rewrite `hybridSearch` as thin wrapper with explicit file-level dedupe. Verify: `npm test` — all T3 tests now pass.
- [ ] **T6 — Batched embeddings.** Embed in batches of 64 inside `rankChunks`. Verify: 1000-chunk synthetic test completes without OOM/error.
- [ ] **T7 — Eval regression check.** Run the existing semantic-recall eval on `.ai/`. Confirm no score regression vs pre-refactor baseline (capture both numbers). Verify: delta ≤ 0 (non-regression).
- [ ] **T8 — Docs + PR prep.** Update any relevant doc (README search section, if present). Write PR description. Verify: `git diff main...HEAD` review clean; PR draft ready for operator approval.

## Files touched (expected)

- `src/hybrid-search/index.ts`
- `src/hybrid-search/index.test.ts` (new or augmented)
- `specs/*` (this folder)
- `progress.txt`, `LEARNINGS.md` (append-only)
