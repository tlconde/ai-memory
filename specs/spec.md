# Spec: LongMemEval Phase 1 baseline harness

## Why

We need a reproducible baseline number on LongMemEval to position ai-memory's hybrid retrieval against published systems (Emergence ~86%, Mastra 84.23%, Oracle GPT-4o ~82.4%, Zep 71.2%, full-context 60–64% per third-party reports). Without this, "state of the art" has no referent.

## What

A benchmark harness under `benchmarks/longmemeval/` that:

1. Fetches `longmemeval-cleaned` datasets (oracle + S) from HuggingFace, with recorded SHA256.
2. Adapts each question's `haystack_sessions` into ai-memory `Chunk[]` at turn and session granularity.
3. Runs retrieval via the new `rankChunks` API, with per-haystack embedding cache.
4. Feeds top-k chunks + question to a pinned reader (`gpt-4o-2024-08-06`, temperature 0), producing a hypothesis string.
5. Writes output JSONL (`{question_id, hypothesis}`) compatible with `evaluate_qa.py`.
6. Wraps the upstream Python `evaluate_qa.py` invocation and summarises overall + per-`question_type` accuracy.

## Success criteria

1. Runs end-to-end on `longmemeval_oracle.json` (500 questions, 15 MB) with hybrid mode. Produces a JSONL that `evaluate_qa.py` accepts without error.
2. Runs end-to-end on `longmemeval_s_cleaned.json` (500 questions, 277 MB) with hybrid mode.
3. Outputs both overall accuracy and per-`question_type` accuracy; includes abstention handling (questions with `_abs` suffix).
4. All configurations (reader model, judge model, topK, chunk granularity, mode, embedding model) captured in a `run-manifest.json` next to each JSONL output.
5. A dry-run mode that limits to N questions (for iteration without burning $$).
6. Zero regression to product paths: `npm test` + `npm run build` pass as before.

## Out of scope

- Phase 2 items: reranking, S1 segmentation variants.
- M split (2.74 GB) — stretch goal only.
- Scoring without the upstream Python scorer (we wrap, not re-implement).
- Publishing a leaderboard entry.
