/**
 * Simple in-memory cache for per-question embeddings. Keyed by `question_id`.
 *
 * Rationale (see specs/plan.md §Retriever): rankChunks batch-embeds on every
 * call, so if the harness re-runs the same question across modes or topK
 * sweeps within one process we can skip the expensive embed pass. Phase 1
 * persists nothing to disk — the cache is scoped to a single `runAll`.
 */

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
}

export class MemoCache<V> {
  private store = new Map<string, V>();
  private _hits = 0;
  private _misses = 0;

  get(key: string): V | undefined {
    const v = this.store.get(key);
    if (v === undefined) this._misses++;
    else this._hits++;
    return v;
  }

  set(key: string, value: V): void {
    this.store.set(key, value);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  clear(): void {
    this.store.clear();
    this._hits = 0;
    this._misses = 0;
  }

  stats(): CacheStats {
    return { hits: this._hits, misses: this._misses, size: this.store.size };
  }
}
