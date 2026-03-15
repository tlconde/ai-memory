/**
 * Approach B: In-house hybrid pipeline (Transformers.js + keyword + RRF)
 * Indexes .md files in test-data/.ai/, runs 5 test queries 3x each.
 */
import { pipeline } from "@huggingface/transformers";
import { readdir, readFile, writeFile } from "fs/promises";
import { join, relative, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AI_ROOT = join(__dirname, "..", "test-data", ".ai");
const RESULTS_PATH = join(__dirname, "..", "results", "inhouse-results.json");
const RRF_K = 60;

// Expected file per query (for recall check)
const EXPECTED = {
  "PostgreSQL connection pooling": "memory/decisions.md",
  "database connection management": "memory/decisions.md",
  "authentication strategy": "memory/decisions.md",
  "login and signup flow": "memory/decisions.md",
  "OOM memory leak": "memory/debugging.md",
};

const TEST_QUERIES = Object.keys(EXPECTED);

// --- Helpers ---

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function tensorToArray(tensor) {
  if (Array.isArray(tensor)) return tensor;
  if (!tensor?.data) {
    if (tensor?.tolist) return tensor.tolist();
    throw new Error("Unknown tensor format: " + typeof tensor);
  }
  const data = Array.from(tensor.data);
  const dims = tensor.dims ?? tensor.size;
  if (Array.isArray(dims) && dims.length >= 2) {
    const [rows, cols] = dims;
    const out = [];
    for (let i = 0; i < rows; i++) {
      out.push(data.slice(i * cols, (i + 1) * cols));
    }
    return out;
  }
  return data;
}

function rrfMerge(rankLists, k = RRF_K) {
  const scores = new Map();
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

// --- Indexing ---

async function loadMdFiles(aiDir) {
  const chunks = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.name === "temp") continue;
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".md")) {
        const content = await readFile(full, "utf-8");
        const rel = relative(aiDir, full).replace(/\\/g, "/");
        // Chunk by ## sections; fallback to whole file
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

// --- Keyword search (TF: count term matches) ---

function keywordSearch(chunks, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const fileScores = new Map();
  for (const { file, text } of chunks) {
    const lower = text.toLowerCase();
    let score = 0;
    for (const term of terms) {
      score += lower.split(term).length - 1;
    }
    if (score > 0) {
      fileScores.set(file, (fileScores.get(file) ?? 0) + score);
    }
  }
  return [...fileScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([file]) => file);
}

// --- Semantic search ---

async function semanticSearch(extractor, chunks, queryEmbedding, chunksEmbeddings) {
  const sims = chunksEmbeddings.map((emb, i) => ({
    file: chunks[i].file,
    sim: cosineSimilarity(queryEmbedding, emb),
  }));
  const byFile = new Map();
  for (const { file, sim } of sims) {
    const cur = byFile.get(file) ?? -Infinity;
    if (sim > cur) byFile.set(file, sim);
  }
  return [...byFile.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([file]) => file);
}

// --- Main ---

async function main() {
  const setupStart = performance.now();

  console.log("Loading model Xenova/all-MiniLM-L6-v2...");
  const extractor = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2"
  );
  const setupTimeSeconds = (performance.now() - setupStart) / 1000;
  console.log(`Model loaded in ${setupTimeSeconds.toFixed(2)}s`);

  const chunks = await loadMdFiles(AI_ROOT);
  console.log(`Indexed ${chunks.length} chunks from .ai/`);

  // Embed all chunks (batch for efficiency)
  const chunkTexts = chunks.map((c) => c.text);
  const chunkEmbRaw = await extractor(chunkTexts, {
    pooling: "mean",
    normalize: true,
  });
  const chunksEmbeddings = [];
  const dim = 384;
  const data = tensorToArray(chunkEmbRaw);
  if (Array.isArray(data[0])) {
    chunksEmbeddings.push(...data);
  } else {
    for (let i = 0; i < data.length; i += dim) {
      chunksEmbeddings.push(data.slice(i, i + dim));
    }
  }

  const queries = [];
  let totalLatency = 0;
  let runCount = 0;

  for (const query of TEST_QUERIES) {
    const latencyMs = [];
    let resultsPreview = [];
    let top5Files = [];

    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();

      const qEmbRaw = await extractor(query, {
        pooling: "mean",
        normalize: true,
      });
      const qEmb = tensorToArray(qEmbRaw);
      const queryEmbedding = Array.isArray(qEmb[0]) ? qEmb[0] : qEmb;

      const kwList = keywordSearch(chunks, query);
      const semList = await semanticSearch(
        extractor,
        chunks,
        queryEmbedding,
        chunksEmbeddings
      );

      const merged = rrfMerge([kwList, semList], RRF_K);
      top5Files = merged.slice(0, 5);

      const elapsed = performance.now() - t0;
      latencyMs.push(Math.round(elapsed));
      totalLatency += elapsed;
      runCount++;

      if (run === 0) {
        resultsPreview = top5Files.map((f) => {
          const c = chunks.find((x) => x.file === f);
          const excerpt = c?.text?.slice(0, 80) ?? "";
          return `${f}: ${excerpt}...`;
        });
      }
    }

    const expectedFile = EXPECTED[query];
    const recall = top5Files.includes(expectedFile);

    queries.push({
      query,
      latency_ms: latencyMs,
      recall,
      results_preview: resultsPreview,
    });
    console.log(
      `"${query}" -> recall=${recall} latency=${latencyMs.join(",")}ms`
    );
  }

  const avgLatencyMs = Math.round(totalLatency / runCount);
  const results = {
    approach: "in-house",
    setup_time_seconds: Math.round(setupTimeSeconds * 100) / 100,
    queries,
    avg_latency_ms: avgLatencyMs,
    notes:
      "Transformers.js feature-extraction + Xenova/all-MiniLM-L6-v2 (~23MB). First run downloads model.",
  };

  await writeFile(RESULTS_PATH, JSON.stringify(results, null, 2));
  console.log(`\nResults written to ${RESULTS_PATH}`);
  return results;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
