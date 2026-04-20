# Spec: Chunk-level retrieval in hybrid-search

## Why

The LongMemEval benchmark (see `.cursor/plans/longmemeval_research_plan_2c3db888.plan.md`) requires retrieving individual conversation turns, but `hybridSearch` today operates at **file** granularity: both `keywordSearchChunks` and `semanticSearchChunks` dedupe to one result per `.md` file, and `rrfMerge` operates on file paths. This blocks the benchmark and wastes signal we already compute per-chunk.

## What

Factor out a chunk-level retrieval API that operates on an in-memory `Chunk[]` and returns per-chunk rankings with full score provenance (RRF score, per-retriever rank, raw score). Keep `hybridSearch` working byte-identically for its three current consumers.

## Success criteria

1. New exported `rankChunks(chunks, query, opts)` function in `src/hybrid-search/` returns ranked chunks with `rrfScore`, `kwRank`, `semRank`, `kwScore`, `semSim`.
2. Existing `hybridSearch` public signature and return shape unchanged; all three consumers (`memory.ts`, `governance.ts`, `search-quality.ts`) work without modification.
3. A file with multiple `## ` sections still produces ≤1 result per file from `hybridSearch` (regression guard); `rankChunks` on the same content returns up to one per section.
4. Unit tests cover: keyword-only, semantic-only, hybrid, empty chunk list, single chunk, multi-section file dedupe, deprecated-filter passthrough, tag filter passthrough.
5. Eval suite (`npm run eval` or equivalent) passes with no score regression on the existing semantic-recall eval.

## Out of scope

- Benchmark harness itself (subsequent work unit).
- BM25 / any change to keyword scoring algorithm.
- Reranker (Phase 2 of benchmark plan).
- Metadata filters beyond existing `tags`/`includeDeprecated`.
