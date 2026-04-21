/**
 * Thin wrapper over `rankChunks` that memoizes per-question results by a
 * composite cache key so repeated calls (same qid, same mode, same query,
 * same topK, same granularity) return cached `RankedChunk[]` rather than
 * re-embedding.
 *
 * NOTE: the cache stores the full ranked result, not raw embeddings. We do not
 * own embedding state inside `rankChunks`; persisting vectors would require
 * surgery to the hybrid-search module, which this harness is forbidden from
 * touching beyond imports. Caching the ranked result is equivalent for our
 * use-case (a second call with identical inputs would produce the same
 * output) and is observable in tests via a call counter.
 */
import {
  rankChunks,
  type Chunk,
  type RankedChunk,
  type SearchMode,
} from "../../../src/hybrid-search/index.js";
import { MemoCache } from "./cache.js";

export interface RetrieveOptions {
  mode: SearchMode;
  topK: number;
  /**
   * Unique key for memoization. Recommended: `${question_id}::${granularity}::${mode}::${topK}`.
   *
   * FRAGILITY: the key does NOT include the query or a hash of `chunks`. Safe only
   * under the harness's current usage (one Retriever per `runAll`, unique qids,
   * same query per qid). Reusing a Retriever across different haystacks that
   * collide on `cacheKey` would return stale results. If the harness ever calls
   * `retrieve` multiple times per question with different queries, add a query
   * hash to the key.
   *
   * NOTE on call path: we call `rankChunks` directly (not `hybridSearch`), so
   * file-level dedupe does NOT apply — turn-granularity chunks compete
   * independently even though they share a `file` field (see chunker.ts).
   */
  cacheKey: string;
}

export type RankFn = (
  chunks: Chunk[],
  query: string,
  options: { mode: SearchMode; topK: number }
) => Promise<{ results: RankedChunk[] }>;

export class Retriever {
  private cache = new MemoCache<RankedChunk[]>();
  private rankFn: RankFn;
  /** Exposed for tests: counts calls that actually hit the underlying rank fn. */
  public rankCalls = 0;

  constructor(rankFn?: RankFn) {
    this.rankFn =
      rankFn ??
      (async (chunks, query, options) => {
        const r = await rankChunks(chunks, query, options);
        return { results: r.results };
      });
  }

  async retrieve(
    chunks: Chunk[],
    query: string,
    options: RetrieveOptions
  ): Promise<RankedChunk[]> {
    const cached = this.cache.get(options.cacheKey);
    if (cached !== undefined) return cached;
    this.rankCalls++;
    const { results } = await this.rankFn(chunks, query, {
      mode: options.mode,
      topK: options.topK,
    });
    this.cache.set(options.cacheKey, results);
    return results;
  }

  stats() {
    return this.cache.stats();
  }
}
