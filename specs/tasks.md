# Tasks: LongMemEval Phase 1 baseline harness

One task per commit. Verification command passes before checkbox.

- [ ] **T1 — Scaffold benchmarks/longmemeval/ layout.** Create tsconfig, types.ts, package additions, .gitignore rules, empty stubs for each module. Verify: `npm run build` passes with zero new errors.
- [ ] **T2 — Dataset fetcher + tests.** `dataset.ts`: fetch oracle + S from HF resolve URLs, compute SHA256, cache to `data/`. Tests use a tiny synthetic fixture. Verify: `npm test` adds new passing tests; a manual `fetch-dataset.sh oracle` succeeds and records hash.
- [ ] **T3 — Chunker + tests.** `chunker.ts` both granularities. Stable IDs. Unit tests with a hand-built question fixture covering 2 sessions × 3 turns. Verify: `npm test` green.
- [ ] **T4 — Retriever wrapper + embedding cache.** `retriever.ts` wraps `rankChunks` with a per-question embedding cache (in-memory Map). Test: same chunks+query called twice uses cache on the second call (observable via timing or a counter).
- [ ] **T5 — Reader (OpenAI).** `reader.ts` with pinned model, temperature 0, max_output_tokens=150, prompt template constant. No test (integration costs money); manual smoke test documented.
- [ ] **T6 — Runner + JSONL writer.** `runner.ts` + `jsonl.ts`. Concurrency=4. Per-question error capture. Test: `jsonl.test.ts` round-trips. Runner tested end-to-end with a mocked reader (fake completion).
- [ ] **T7 — CLI.** `cli.ts` with `run` and `score` subcommands. Flag validation. `run-manifest.json` written. Verify: `tsx benchmarks/longmemeval/src/cli.ts run --help` exits 0.
- [ ] **T8 — Python eval wrapper.** Clone upstream at pinned commit into `third_party/` (gitignored except lockfile recording SHA). `scripts/run-evaluate-qa.sh` shells into it. `scores.json` extracted from its output. Verify: script runs end-to-end against a tiny synthetic JSONL.
- [ ] **T9 — README.** Single-command install + run docs; cost table; known caveats (M stretch; pinned commits; abstention semantics). No verify command.
- [ ] **T10 — Smoke test on oracle, 10 questions.** `--dataset oracle --mode hybrid --limit 10`. Confirm JSONL produced, confirm `score` subcommand runs `evaluate_qa.py` successfully. Capture numbers in LEARNINGS (non-representative — smoke, not headline). Verify: exit 0; scores.json populated.

## Files touched (expected)

- `benchmarks/longmemeval/**` (new)
- `.gitignore` (add `benchmarks/longmemeval/data/`, `runs/`, `third_party/`)
- `package.json` (add `openai` devDep; add `bench:run`, `bench:score` scripts)
- `LEARNINGS.md`, `progress.txt` (append)
- Root `tsconfig.json` (exclude `benchmarks/**`)

## Headline run (post-Phase 1, separate task outside this sequence)

Running the full 500-question S with hybrid/keyword and writing up the positioning paragraph is a *separate* work unit after T1–T10 land.
