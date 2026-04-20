# Plan: Chunk-level retrieval refactor

## Stack

Existing: TypeScript strict, Node ESM, `@huggingface/transformers` (MiniLM), Vitest (verify via `ls tests/` or package.json scripts before writing). No new deps.

## API shape

Revised after T1 critique (see LEARNINGS.md).

```ts
export interface Chunk {
  id?: string;             // opaque, in-process identity. loadChunks fills it; rankChunks synthesizes if absent.
  file: string;
  text: string;
  content: string;
}

export interface RankedChunk {
  chunk: Chunk;            // chunk.id guaranteed populated
  rrfScore: number;        // raw RRF, not normalized; formula: Σ 1/(k + rank + 1)
  kwRank?: number;         // 0-indexed rank in keyword list. undefined = keyword retriever did not run.
  semRank?: number;        // undefined = semantic retriever did not run.
  kwScore?: number;        // raw TF count
  semSim?: number;         // cosine similarity in [-1, 1]
}

export interface RankChunksOptions {
  mode: SearchMode;
  topK?: number;           // chunk-level cap. default 10.
  tags?: string[];
  includeDeprecated?: boolean;
}

export async function rankChunks(
  chunks: Chunk[],
  query: string,
  options: RankChunksOptions,
): Promise<{ results: RankedChunk[]; backend: SearchBackend }>;
```

`hybridSearch` becomes: `loadChunks → rankChunks → group-by-file (first wins) → top-limit → map to SearchResult with score=1 for semantic/hybrid modes`.

## Contracts

- **Empty `chunks[]`** → `{results: [], backend: "keyword"}`. No model load.
- **Empty / whitespace-only `query`** → same.
- **Stopword-only query** in hybrid mode → keyword list empty, semantic list populated (current behavior preserved).
- **Tag filter** runs inside `rankChunks` pre-retrieval; excluded chunks do not appear in results.
- **Tie-breaking:** secondary sort by `chunk.id` ascending.
- **Embedding batch size:** hardcoded 64. Batched result must agree with unbatched within 1e-6 (test required).
- **`score: 1` stub in `hybridSearch`:** preserved in semantic/hybrid modes for backward compat with `governance.ts:141` semantic-constraint gating. Explicit test required.
- **`getLastSearchBackend()`:** marked `@deprecated`, not removed. Response envelope's `backend` field is the replacement.

## Internal changes

1. **`Chunk.id`** — assigned in `loadChunks` as `${relativePath}#${sectionIndex}` (0-indexed, deterministic because `split(/(?=^## )/m)` preserves order).
2. **`keywordSearchChunks`** — drop `fileBest` dedupe. Return `Array<{ id, score }>` sorted by score desc.
3. **`semanticSearchChunks`** — drop `byFile` dedupe. Return `Array<{ id, sim }>` sorted by sim desc.
4. **`rrfMerge`** — return `Array<{ id, rrfScore }>` instead of `string[]`. (Internal, no public consumer.)
5. **`rankChunks`** — new exported function. Owns filtering (deprecated/tags), keyword + embed + RRF, and attaches per-retriever rank/score metadata.
6. **`hybridSearch`** — rewrite on top of `rankChunks`. Post-process: group by `chunk.file`, keep first (highest-ranked) per file, slice to `limit`.

## File layout

- `src/hybrid-search/index.ts` — main refactor.
- `src/hybrid-search/rank-chunks.ts` — optional split if `index.ts` exceeds ~500 lines after changes. Decide during implementation.
- `src/hybrid-search/index.test.ts` (new or augmented) — unit tests.

## Risks & mitigations

- **Embedding batch size.** Current code embeds all filtered chunks in one call. For LongMemEval haystacks (500+ chunks) this may exceed MiniLM's practical batch limit. Mitigation: chunk the embed call into batches of 64 inside `rankChunks`. Verify with a synthetic 1000-chunk test.
- **Product regression.** The file-level dedupe in `hybridSearch` must match today's "highest-scoring-chunk wins" behavior. Mitigation: explicit test comparing a pre- and post-refactor fixture.
- **Score of 1 stub.** Today `hybridSearch` returns `score: 1` for hybrid/semantic. Preserve this in the product path to avoid silently changing MCP consumer output.

## Verification

Per task, before commit:
```
npm run build   # tsc strict
npm test        # vitest
npm run eval -- --semantic-recall   # if command exists; otherwise document
```
