# LongMemEval Phase 1 harness

Reproducible baseline numbers for ai-memory's hybrid retrieval on
[LongMemEval](https://github.com/xiaowu0162/LongMemEval). Not published;
internal benchmark only.

## Layout

```
benchmarks/longmemeval/
  src/             TypeScript harness (chunker, retriever wrapper, Gemini reader, runner, CLI)
  scripts/         fetch-scorer.sh, run-evaluate-qa.sh, SCORER_COMMIT.txt
  python/          requirements.txt (reference — uv resolves deps on the fly)
  third_party/     upstream LongMemEval clone at pinned SHA (gitignored)
  data/            local cache (gitignored) — datasets actually live on external SSD
  runs/            one subdir per run: hypotheses.jsonl, run-manifest.json, errors.log, scores.json (gitignored)
  .env.local       GEMINI_API_KEY, OPENAI_API_KEY, LME_DATA_DIR (gitignored)
```

## Prereqs

- Node 20+ with the root install done (`npm install` from repo root adds `@google/genai`).
- [`uv`](https://docs.astral.sh/uv/) on PATH — used by `run-evaluate-qa.sh` to
  invoke the Python scorer with ephemeral deps.
- The datasets downloaded onto an external SSD. File hashes are pinned in
  `src/dataset.ts` — they are verified on load and the harness aborts on
  mismatch.

  ```
  $LME_DATA_DIR/
    longmemeval_oracle.json       sha256=821a2034…
    longmemeval_s_cleaned.json    sha256=d6f21ea9…
  ```

## Setup

```bash
cp benchmarks/longmemeval/.env.local.example benchmarks/longmemeval/.env.local
# edit .env.local; fill in GEMINI_API_KEY, OPENAI_API_KEY, LME_DATA_DIR

# Clone upstream scorer at the pinned SHA (one-time).
bash benchmarks/longmemeval/scripts/fetch-scorer.sh
```

## Run (dry / smoke)

Cost safety: the CLI refuses to run without **either** `--limit N` or
`--no-limit`. Always dry-run before a full sweep.

```bash
npx tsx benchmarks/longmemeval/src/cli.ts run \
  --dataset oracle \
  --mode hybrid \
  --granularity turn \
  --topk 10 \
  --limit 10
```

Outputs to `benchmarks/longmemeval/runs/<timestamp>/`:

- `hypotheses.jsonl` — `{question_id, hypothesis, question_type, error?}` per row.
- `run-manifest.json` — dataset SHA256, reader model, judge model, topK,
  granularity, mode, git HEAD, ISO timestamp, prompt-template SHA256,
  per-question p50/p95 timings.
- `errors.log` — per-question error detail if any.

## Score

Runs the upstream Python judge (`evaluate_qa.py`) against the hypotheses.

```bash
npx tsx benchmarks/longmemeval/src/cli.ts score \
  --run benchmarks/longmemeval/runs/<timestamp>
```

Writes `scores.json` with overall and per-`question_type` accuracy. The raw
`<hyp>.eval-results-<judge>` file from the Python scorer is also persisted
(upstream format, for audit).

## Full run

```bash
npx tsx benchmarks/longmemeval/src/cli.ts run \
  --dataset s --mode hybrid --granularity turn --topk 10 --no-limit
```

## Cost estimate (approximate)

| Dataset | Questions | Reader (Gemini 2.5 Pro, topK=10 turn) | Judge (GPT-4o) |
|---------|-----------|---------------------------------------|----------------|
| oracle  | 500       | ~$5–15 (small haystacks)              | <$1            |
| S       | 500       | $25–50 (larger haystacks)             | <$1            |

Numbers are order-of-magnitude — verify with a small `--limit` run before
committing to a full sweep.

## Caveats

- Abstention questions are identified by `_abs` suffix on `question_id`; the
  upstream scorer handles them via a different judge prompt. No harness-side
  work required.
- The oracle split is not temporally sorted (README, upstream); S and M are.
- `max_output_tokens=150` on the reader — all answers are short by design.
- M split (2.74 GB) is out of scope for Phase 1.
- The prompt template SHA is hashed into each manifest. Runs with different
  prompt SHAs are not comparable.

## Testing

From the repo root:

```bash
npm test          # includes benchmarks/longmemeval/src/**/*.test.ts
npm run typecheck
```

## What's not here

- No disk embedding cache. Chunk embeddings are recomputed per run (but
  memoized across modes in the same process).
- No reranker (Phase 2).
- No automatic dataset fetch — they live on the SSD.
