/**
 * Hybrid search: keyword (TF) + semantic (Transformers.js) + RRF.
 *
 * Public surface:
 * - `rankChunks(chunks, query, options)` — chunk-level retrieval. Returns per-chunk rankings
 *   with full score provenance (rrfScore, kwRank/kwScore, semRank/semSim). Used by the
 *   LongMemEval benchmark harness (subsequent work unit) and future consumers needing
 *   per-chunk signal rather than file-level results.
 * - `hybridSearch(aiDir, query, options)` — file-level search (byte-compatible with prior
 *   behavior): loadChunks → rankChunks → group by file (first-seen wins) → slice to limit
 *   → map to SearchResult with stubbed score=1 in semantic/hybrid modes.
 *
 * On Windows, onnxruntime-node may fail; set AI_SEARCH_WASM=1 to prefer WASM, or
 * AI_SEARCH=keyword for keyword-only.
 */
import { readdir, readFile } from "fs/promises";
import { join, relative, dirname } from "path";
import { createRequire } from "module";
import { pathToFileURL } from "url";

const RRF_K = 60;
const EMBED_BATCH_SIZE = 64;
const EMBED_DIM = 384;

/** Extract meaningful excerpt from chunk text, skipping YAML frontmatter. Returns up to ~300 chars. */
function extractExcerpt(text: string): string {
  const lines = text.split("\n");
  let i = 0;
  // Skip YAML frontmatter block (--- ... ---)
  if (lines[i]?.trim() === "---") {
    i++;
    while (i < lines.length && lines[i]?.trim() !== "---") i++;
    i++; // skip closing ---
  }
  // Collect meaningful lines up to ~300 chars
  const parts: string[] = [];
  let len = 0;
  while (i < lines.length && len < 300) {
    const line = lines[i]?.trim();
    if (line && line !== "---") {
      parts.push(line);
      len += line.length;
    }
    i++;
  }
  return parts.join(" ") || text.split("\n")[0]?.trim() || "";
}

export type SearchMode = "keyword" | "semantic" | "hybrid";

/** Backend used for search: native (onnxruntime-node), wasm, or keyword-only. */
export type SearchBackend = "native" | "wasm" | "keyword";

export interface SearchResult {
  file: string;
  excerpt: string;
  score: number;
}

export interface HybridSearchResponse {
  results: SearchResult[];
  backend: SearchBackend;
}

export interface Chunk {
  /**
   * Opaque, in-process identity. NOT content-addressable — consumers must not parse it.
   * `loadChunks` assigns `${relativePath}#${sectionIndex}` (0-indexed). `rankChunks`
   * synthesizes `__anon_${i}` for input chunks without an id.
   */
  id?: string;
  file: string;
  text: string;
  content: string;
}

export interface RankedChunk {
  /** The chunk; `chunk.id` is guaranteed populated in the returned results. */
  chunk: Chunk;
  /** Raw (not normalized) RRF score. Formula: Σ 1/(k + rank + 1) over participating retrievers. */
  rrfScore: number;
  /** 0-indexed rank in keyword list. undefined = keyword retriever did not run OR chunk absent from list. */
  kwRank?: number;
  /** 0-indexed rank in semantic list. undefined = semantic retriever did not run OR chunk absent from list. */
  semRank?: number;
  /** Raw keyword term-frequency count. */
  kwScore?: number;
  /** Cosine similarity in [-1, 1]. */
  semSim?: number;
}

export interface RankChunksOptions {
  mode: SearchMode;
  /** Chunk-level cap. Default 10. */
  topK?: number;
  tags?: string[];
  includeDeprecated?: boolean;
}

export interface RankChunksResponse {
  results: RankedChunk[];
  backend: SearchBackend;
}

// ─── Chunk loading ───────────────────────────────────────────────────────────

export async function loadChunks(aiDir: string): Promise<Chunk[]> {
  const chunks: Chunk[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.name === "temp") continue;
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith(".md")) {
        const content = await readFile(full, "utf-8");
        const rel = relative(aiDir, full).replace(/\\/g, "/");
        const sections = content.split(/(?=^## )/m).filter(Boolean);
        if (sections.length === 0) {
          // Single-chunk file. Index 0 for deterministic id.
          chunks.push({ id: `${rel}#0`, file: rel, text: content, content });
        } else {
          let sectionIndex = 0;
          for (const section of sections) {
            const text = section.trim();
            if (text.length > 0) {
              chunks.push({ id: `${rel}#${sectionIndex}`, file: rel, text, content });
            }
            sectionIndex++;
          }
        }
      }
    }
  }

  await walk(aiDir);
  return chunks;
}

// ─── Keyword search (TF) ──────────────────────────────────────────────────────

/**
 * Chunk-level keyword search. Returns entries sorted by TF score desc, then id asc.
 * Chunks with score 0 are excluded. No file-level dedupe.
 */
function keywordSearchChunks(
  chunks: Chunk[],
  query: string
): Array<{ id: string; score: number }> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const scored: Array<{ id: string; score: number }> = [];
  for (const chunk of chunks) {
    const lower = chunk.text.toLowerCase();
    let score = 0;
    for (const term of terms) {
      score += lower.split(term).length - 1;
    }
    if (score > 0) {
      // chunk.id is guaranteed set by caller (rankChunks synthesizes if absent).
      scored.push({ id: chunk.id as string, score });
    }
  }
  scored.sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return scored;
}

// ─── Semantic search (Transformers.js) ───────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function tensorToArray(tensor: unknown): number[] | number[][] {
  const t = tensor as { data?: ArrayLike<number>; dims?: number[]; size?: number[]; tolist?: () => unknown[] };
  if (Array.isArray(tensor)) return tensor as number[][];
  if (!t?.data) {
    if (typeof t?.tolist === "function") return t.tolist() as number[][];
    throw new Error("Unknown tensor format");
  }
  const data = Array.from(t.data);
  const dims = t.dims ?? t.size ?? [];
  if (Array.isArray(dims) && dims.length >= 2) {
    const [rows, cols] = dims;
    const out: number[][] = [];
    for (let i = 0; i < rows; i++) {
      out.push(data.slice(i * cols, (i + 1) * cols));
    }
    return out;
  }
  return data as number[];
}

/**
 * Chunk-level semantic ranking. Given pre-computed chunk embeddings aligned to `chunks`
 * by index, returns entries sorted by cosine similarity desc, then id asc.
 * No file-level dedupe.
 */
function semanticSearchChunks(
  chunks: Chunk[],
  chunksEmbeddings: number[][],
  queryEmbedding: number[]
): Array<{ id: string; sim: number }> {
  const sims: Array<{ id: string; sim: number }> = [];
  for (let i = 0; i < chunks.length; i++) {
    sims.push({
      id: chunks[i].id as string,
      sim: cosineSimilarity(queryEmbedding, chunksEmbeddings[i]),
    });
  }
  sims.sort((a, b) => (b.sim - a.sim) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sims;
}

/**
 * Reciprocal Rank Fusion over id lists. Returns entries sorted by rrfScore desc, then id asc.
 * Raw (not normalized) score. Formula: Σ 1/(k + rank + 1) over lists in which the id appears.
 */
function rrfMerge(rankLists: string[][], k = RRF_K): Array<{ id: string; rrfScore: number }> {
  const scores = new Map<string, number>();
  for (const list of rankLists) {
    list.forEach((id, rank) => {
      const rrf = 1 / (k + rank + 1);
      scores.set(id, (scores.get(id) ?? 0) + rrf);
    });
  }
  const merged = [...scores.entries()].map(([id, rrfScore]) => ({ id, rrfScore }));
  merged.sort((a, b) => (b.rrfScore - a.rrfScore) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return merged;
}

// Lazy-loaded semantic extractor
let extractor: Awaited<ReturnType<typeof import("@huggingface/transformers").pipeline>> | null = null;
let backendUsed: SearchBackend = "keyword";

function isWindows(): boolean {
  return process.platform === "win32";
}

function preferWasm(): boolean {
  return process.env.AI_SEARCH_WASM === "1" || process.env.AI_SEARCH_WASM === "true";
}

async function loadNativeExtractor(): Promise<Awaited<ReturnType<typeof import("@huggingface/transformers").pipeline>>> {
  const { pipeline, env } = await import("@huggingface/transformers");
  const modelPath = process.env.AI_MODEL_PATH;
  if (modelPath) {
    env.localModelPath = modelPath;
    env.allowRemoteModels = false;
  }
  return pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "fp32" });
}

async function loadWasmExtractor(): Promise<Awaited<ReturnType<typeof import("@huggingface/transformers").pipeline>>> {
  const require = createRequire(import.meta.url);
  const pkgRoot = dirname(require.resolve("@huggingface/transformers/package.json"));
  const webPath = join(pkgRoot, "dist", "transformers.web.js");
  const mod = await import(pathToFileURL(webPath).href);
  const { pipeline, env } = mod;
  const modelPath = process.env.AI_MODEL_PATH;
  if (modelPath) {
    env.localModelPath = modelPath;
    env.allowRemoteModels = false;
  }
  return pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "fp32" });
}

async function getExtractor(): Promise<Awaited<ReturnType<typeof import("@huggingface/transformers").pipeline>>> {
  if (extractor) return extractor;

  const tryWasmFirst = preferWasm() || (isWindows() && !process.env.AI_SEARCH_FORCE_NATIVE);

  if (tryWasmFirst) {
    try {
      extractor = await loadWasmExtractor();
      backendUsed = "wasm";
      return extractor;
    } catch {
      // Fall through to try native
    }
  }

  try {
    extractor = await loadNativeExtractor();
    backendUsed = "native";
    return extractor;
  } catch (nativeErr) {
    if (!tryWasmFirst) {
      try {
        extractor = await loadWasmExtractor();
        backendUsed = "wasm";
        return extractor;
      } catch {
        // Re-throw original native error for clearer message
      }
    }
    throw nativeErr;
  }
}

/** Pre-warm the semantic model (download + load). Call at init or session start to avoid first-query latency. */
export async function warmSearchModel(): Promise<void> {
  if (getSearchMode() === "keyword") return;
  await getExtractor();
}

/**
 * Backend used for the last semantic/hybrid search, or "keyword" if only keyword was used.
 *
 * @deprecated Module-global state is racy under concurrent calls. Use the `backend` field
 * on the `HybridSearchResponse` / `RankChunksResponse` envelope instead.
 */
export function getLastSearchBackend(): SearchBackend {
  return backendUsed;
}

/** Coerce an embedding tensor/array into a 2-D array of shape [n, EMBED_DIM]. */
function embeddingTensorTo2D(raw: unknown): number[][] {
  const data = tensorToArray(raw);
  if (Array.isArray(data[0])) return data as number[][];
  const flat = data as number[];
  const out: number[][] = [];
  for (let i = 0; i < flat.length; i += EMBED_DIM) {
    out.push(flat.slice(i, i + EMBED_DIM));
  }
  return out;
}

/**
 * Embed texts in batches of EMBED_BATCH_SIZE to avoid OOM / practical-limit issues
 * with MiniLM on large haystacks (500+ chunks). Concatenates per-batch outputs.
 *
 * With `normalize: true` each vector is L2-normalized independently, so batched and
 * unbatched outputs agree to within floating-point noise (test verifies ≤ 1e-6).
 */
async function embedInBatches(
  ext: Awaited<ReturnType<typeof import("@huggingface/transformers").pipeline>>,
  texts: string[]
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const raw = await ext(batch, { pooling: "mean", normalize: true });
    const rows = embeddingTensorTo2D(raw);
    for (const row of rows) out.push(row);
  }
  return out;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Rank chunks against a query. Owns the full chunk-level pipeline:
 *   filter (deprecated, tags) → keyword + semantic retrieval → RRF merge →
 *   attach per-retriever rank/score metadata → sort → slice to topK.
 *
 * Contract:
 * - Empty `chunks[]`, empty/whitespace-only `query` → `{ results: [], backend: "keyword" }`. No model load.
 * - Tag filter runs pre-retrieval; filtered chunks do not appear in results.
 * - Deprecated filter (default on) skips chunks whose first line contains "[DEPRECATED]".
 * - Tie-breaking: secondary sort by `chunk.id` ascending.
 * - Chunks without `id` get synthesized `__anon_${i}` ids (by original input index).
 * - Embeddings batched in groups of EMBED_BATCH_SIZE (64); equivalent to unbatched within 1e-6.
 */
export async function rankChunks(
  chunks: Chunk[],
  query: string,
  options: RankChunksOptions
): Promise<RankChunksResponse> {
  const { mode, topK = 10, tags, includeDeprecated = false } = options;

  if (chunks.length === 0 || query.trim().length === 0) {
    return { results: [], backend: "keyword" };
  }

  // Synthesize ids for any chunks missing one (indexed by original input position).
  const withIds: Chunk[] = chunks.map((c, i) =>
    c.id === undefined ? { ...c, id: `__anon_${i}` } : c
  );

  // Filter: deprecated then tags. Filtered chunks do not appear in results.
  let filtered = includeDeprecated
    ? withIds
    : withIds.filter((c) => {
        const firstLine = c.text.split("\n")[0] ?? "";
        return !firstLine.includes("[DEPRECATED]");
      });

  if (tags && tags.length > 0) {
    const tagLower = tags.map((t) => t.toLowerCase());
    filtered = filtered.filter((c) => {
      const lower = c.text.toLowerCase();
      return tagLower.every((t) => lower.includes(t));
    });
  }

  if (filtered.length === 0) return { results: [], backend: "keyword" };

  const byId = new Map<string, Chunk>();
  for (const c of filtered) byId.set(c.id as string, c);

  // Keyword retrieval runs in all three modes. Tie-break by id asc.
  const kwHits = keywordSearchChunks(filtered, query);
  const kwRankById = new Map<string, number>();
  const kwScoreById = new Map<string, number>();
  kwHits.forEach((h, rank) => {
    kwRankById.set(h.id, rank);
    kwScoreById.set(h.id, h.score);
  });

  if (mode === "keyword") {
    backendUsed = "keyword";
    // RRF over a single list gives a monotonic proxy for rank; here we just use rank directly.
    // For keyword-only mode, sort by score desc (tie-break id asc) — matches kwHits ordering.
    const results: RankedChunk[] = kwHits.slice(0, topK).map((h) => {
      const c = byId.get(h.id) as Chunk;
      const rrf = 1 / (RRF_K + (kwRankById.get(h.id) as number) + 1);
      return {
        chunk: c,
        rrfScore: rrf,
        kwRank: kwRankById.get(h.id),
        kwScore: kwScoreById.get(h.id),
      };
    });
    return { results, backend: "keyword" };
  }

  // semantic or hybrid: embed chunks + query.
  const ext = await getExtractor();
  const chunkTexts = filtered.map((c) => c.text);
  const chunksEmbeddings = await embedInBatches(ext, chunkTexts);

  const qRaw = await ext(query, { pooling: "mean", normalize: true });
  const qRows = embeddingTensorTo2D(qRaw);
  const queryEmb = qRows[0] ?? [];

  const semHits = semanticSearchChunks(filtered, chunksEmbeddings, queryEmb);
  const semRankById = new Map<string, number>();
  const semSimById = new Map<string, number>();
  semHits.forEach((h, rank) => {
    semRankById.set(h.id, rank);
    semSimById.set(h.id, h.sim);
  });

  if (mode === "semantic") {
    // Rank by semantic sim directly. RRF score computed from single list for provenance.
    const results: RankedChunk[] = semHits.slice(0, topK).map((h) => {
      const c = byId.get(h.id) as Chunk;
      const rrf = 1 / (RRF_K + (semRankById.get(h.id) as number) + 1);
      return {
        chunk: c,
        rrfScore: rrf,
        semRank: semRankById.get(h.id),
        semSim: semSimById.get(h.id),
      };
    });
    return { results, backend: backendUsed };
  }

  // hybrid
  const kwIdList = kwHits.map((h) => h.id);
  const semIdList = semHits.map((h) => h.id);
  const merged = rrfMerge([kwIdList, semIdList], RRF_K);

  const results: RankedChunk[] = merged.slice(0, topK).map((m) => {
    const c = byId.get(m.id) as Chunk;
    const out: RankedChunk = {
      chunk: c,
      rrfScore: m.rrfScore,
    };
    const kr = kwRankById.get(m.id);
    if (kr !== undefined) {
      out.kwRank = kr;
      out.kwScore = kwScoreById.get(m.id);
    }
    const sr = semRankById.get(m.id);
    if (sr !== undefined) {
      out.semRank = sr;
      out.semSim = semSimById.get(m.id);
    }
    return out;
  });

  return { results, backend: backendUsed };
}

export interface HybridSearchOptions {
  mode: SearchMode;
  /** File-level cap on results. Default 10. */
  limit?: number;
  tags?: string[];
  includeDeprecated?: boolean;
}

/**
 * Run hybrid search at file granularity (byte-compatible with prior behavior).
 *
 * Pipeline: `loadChunks → rankChunks → group by file (first/highest-ranked wins) →
 * slice to limit → map to SearchResult`.
 *
 * Score semantics:
 * - keyword mode: real TF score from the winning chunk.
 * - semantic / hybrid mode: stub `score: 1`. Preserved intentionally — `governance.ts`
 *   gates P0 semantic constraints on `score >= rule.min_score` (default 0.3), and a
 *   silent switch to real similarities could break rule enforcement. See LEARNINGS.md.
 */
export async function hybridSearch(
  aiDir: string,
  query: string,
  options: HybridSearchOptions
): Promise<HybridSearchResponse> {
  const { mode, limit = 10, tags, includeDeprecated = false } = options;
  const chunks = await loadChunks(aiDir);

  // rankChunks handles all filtering + retrieval. Rank everything and let the
  // file-level dedupe below slice to `limit`. Any topK smaller than chunks.length
  // can underfill when one file dominates the top ranks (e.g. a file with many
  // matching ## sections crowds out other files before dedupe). Sort cost is
  // trivial compared to embedding cost.
  const ranked = await rankChunks(chunks, query, {
    mode,
    topK: Math.max(chunks.length, 1),
    tags,
    includeDeprecated,
  });

  // Group by file, keep first-seen (highest-ranked) chunk per file.
  const seen = new Set<string>();
  const winners: RankedChunk[] = [];
  for (const r of ranked.results) {
    if (seen.has(r.chunk.file)) continue;
    seen.add(r.chunk.file);
    winners.push(r);
    if (winners.length >= limit) break;
  }

  const results: SearchResult[] = winners.map((r) => {
    const excerpt = extractExcerpt(r.chunk.text);
    const score = mode === "keyword" ? (r.kwScore ?? 0) : 1;
    return { file: r.chunk.file, excerpt, score };
  });

  return { results, backend: ranked.backend };
}

/**
 * Get current search mode from env. Default: hybrid.
 */
export function getSearchMode(): SearchMode {
  const v = process.env.AI_SEARCH?.toLowerCase();
  if (v === "keyword" || v === "semantic" || v === "hybrid") return v;
  return "hybrid";
}
