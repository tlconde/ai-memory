/**
 * Hybrid search: keyword (TF) + semantic (Transformers.js) + RRF.
 * Based on experiments/hybrid-search/sandbox-b-inhouse (Approach B).
 */
import { readdir, readFile } from "fs/promises";
import { join, relative } from "path";

const RRF_K = 60;

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
  file: string;
  text: string;
  content: string;
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
        for (const section of sections) {
          const text = section.trim();
          if (text.length > 0) {
            chunks.push({ file: rel, text, content });
          }
        }
        if (sections.length === 0) {
          chunks.push({ file: rel, text: content, content });
        }
      }
    }
  }

  await walk(aiDir);
  return chunks;
}

// ─── Keyword search (TF) ──────────────────────────────────────────────────────

function keywordSearchChunks(chunks: Chunk[], query: string): Array<{ file: string; excerpt: string; score: number }> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const fileBest = new Map<string, { excerpt: string; score: number }>();
  for (const { file, text } of chunks) {
    const lower = text.toLowerCase();
    let score = 0;
    for (const term of terms) {
      score += lower.split(term).length - 1;
    }
    if (score > 0) {
      const cur = fileBest.get(file);
      if (!cur || score > cur.score) {
        const firstLine = text.split("\n")[0]?.trim() ?? "";
        fileBest.set(file, { excerpt: firstLine, score });
      }
    }
  }
  return [...fileBest.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .map(([file, { excerpt, score }]) => ({ file, excerpt, score }));
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

function rrfMerge(rankLists: string[][], k = RRF_K): string[] {
  const scores = new Map<string, number>();
  for (const list of rankLists) {
    list.forEach((id, rank) => {
      const rrf = 1 / (k + rank + 1);
      scores.set(id, (scores.get(id) ?? 0) + rrf);
    });
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

// Lazy-loaded semantic extractor
let extractor: Awaited<ReturnType<typeof import("@huggingface/transformers").pipeline>> | null = null;
let backendUsed: SearchBackend = "keyword";

async function getExtractor(): Promise<Awaited<ReturnType<typeof import("@huggingface/transformers").pipeline>>> {
  if (extractor) return extractor;
  const { pipeline, env } = await import("@huggingface/transformers");
  const modelPath = process.env.AI_MODEL_PATH;
  if (modelPath) {
    env.localModelPath = modelPath;
    env.allowRemoteModels = false;
  }
  extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  backendUsed = "native"; // onnxruntime-node in Node; wasm fallback not implemented yet
  return extractor;
}

/** Pre-warm the semantic model (download + load). Call at init or session start to avoid first-query latency. */
export async function warmSearchModel(): Promise<void> {
  if (getSearchMode() === "keyword") return;
  await getExtractor();
}

/** Backend used for the last semantic/hybrid search, or "keyword" if only keyword was used. */
export function getLastSearchBackend(): SearchBackend {
  return backendUsed;
}

async function semanticSearchChunks(
  chunks: Chunk[],
  chunksEmbeddings: number[][],
  queryEmbedding: number[]
): Promise<string[]> {
  const sims = chunksEmbeddings.map((emb, i) => ({
    file: chunks[i].file,
    sim: cosineSimilarity(queryEmbedding, emb),
  }));
  const byFile = new Map<string, number>();
  for (const { file, sim } of sims) {
    const cur = byFile.get(file) ?? -Infinity;
    if (sim > cur) byFile.set(file, sim);
  }
  return [...byFile.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([file]) => file);
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface HybridSearchOptions {
  mode: SearchMode;
  limit?: number;
  tags?: string[];
}

/**
 * Run hybrid search. Returns results ordered by relevance.
 * - keyword: TF-based only
 * - semantic: vector similarity only (requires model load)
 * - hybrid: RRF merge of keyword + semantic
 */
export async function hybridSearch(
  aiDir: string,
  query: string,
  options: HybridSearchOptions
): Promise<HybridSearchResponse> {
  const { mode, limit = 10, tags } = options;
  const chunks = await loadChunks(aiDir);

  // Tag filter
  let filtered = chunks;
  if (tags && tags.length > 0) {
    const tagLower = tags.map((t) => t.toLowerCase());
    filtered = chunks.filter((c) => {
      const lower = c.text.toLowerCase();
      return tagLower.every((t) => lower.includes(t));
    });
  }

  if (filtered.length === 0) return { results: [], backend: "keyword" };

  const kwResults = keywordSearchChunks(filtered, query);

  if (mode === "keyword") {
    backendUsed = "keyword";
    return { results: kwResults.slice(0, limit), backend: "keyword" };
  }

  const kwFileOrder = kwResults.map((r) => r.file);
  const ext = await getExtractor();
  const dim = 384;

  // Embed chunks (batch)
  const chunkTexts = filtered.map((c) => c.text);
  const chunkEmbRaw = await ext(chunkTexts, { pooling: "mean", normalize: true });
  const data = tensorToArray(chunkEmbRaw);
  const chunksEmbeddings: number[][] = Array.isArray(data[0])
    ? (data as number[][])
    : (() => {
        const flat = data as number[];
        const out: number[][] = [];
        for (let i = 0; i < flat.length; i += dim) {
          out.push(flat.slice(i, i + dim));
        }
        return out;
      })();

  const qEmbRaw = await ext(query, { pooling: "mean", normalize: true });
  const qEmb = tensorToArray(qEmbRaw);
  const queryEmb = Array.isArray(qEmb[0]) ? qEmb[0] : (qEmb as number[]);
  const semFileOrder = await semanticSearchChunks(filtered, chunksEmbeddings, queryEmb);

  if (mode === "semantic") {
    const results = semFileOrder.slice(0, limit).map((file) => {
      const c = filtered.find((x) => x.file === file);
      const excerpt = c?.text.split("\n")[0]?.trim() ?? "";
      return { file, excerpt, score: 1 };
    });
    return { results, backend: backendUsed };
  }

  // hybrid
  const merged = rrfMerge([kwFileOrder, semFileOrder], RRF_K);
  const results = merged.slice(0, limit).map((file) => {
    const c = filtered.find((x) => x.file === file);
    const excerpt = c?.text.split("\n")[0]?.trim() ?? "";
    return { file, excerpt, score: 1 };
  });
  return { results, backend: backendUsed };
}

/**
 * Get current search mode from env. Default: hybrid.
 */
export function getSearchMode(): SearchMode {
  const v = process.env.AI_SEARCH?.toLowerCase();
  if (v === "keyword" || v === "semantic" || v === "hybrid") return v;
  return "hybrid";
}
