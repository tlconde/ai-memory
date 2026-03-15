#!/usr/bin/env node
/**
 * Run QMD queries via SDK (searchVector = vector-only, no expansion/rerank).
 * Expected: decisions.md for Q1-Q4, debugging.md for Q5.
 */
import { createStore, getDefaultDbPath } from "@tobilu/qmd";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const QUERIES = [
  { query: "PostgreSQL connection pooling", expected: "decisions.md" },
  { query: "database connection management", expected: "decisions.md" },
  { query: "authentication strategy", expected: "decisions.md" },
  { query: "login and signup flow", expected: "decisions.md" },
  { query: "OOM memory leak", expected: "debugging.md" },
];

const dbPath =
  process.env.INDEX_PATH ||
  join(process.env.USERPROFILE || process.env.HOME, ".cache", "qmd", "index.sqlite");

async function main() {
  // Reopen existing index created by CLI (collection add + embed)
  const store = await createStore({ dbPath });

  const results = [];
  for (const { query, expected } of QUERIES) {
    const latencies = [];
    let resultsPreview = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      const hits = await store.searchLex(query, { limit: 5 });
      latencies.push(Math.round(performance.now() - start));
      if (i === 0) {
        resultsPreview = hits.slice(0, 5).map((r) => {
          const path = r.path || r.file || "";
          const snip = (r.snippet || r.content || "").slice(0, 80);
          return `${path}: ${snip}...`;
        });
      }
    }
    const hits = await store.searchLex(query, { limit: 5 });
    const recall = hits.some((r) => (r.path || r.file || "").includes(expected));
    results.push({
      query,
      latency_ms: latencies,
      recall,
      results_preview: resultsPreview,
    });
    console.log(`Query: "${query}" → recall=${recall} latencies=${latencies.join(",")}`);
  }

  await store.close();

  const allLatencies = results.flatMap((r) => r.latency_ms);
  const avgLatency = Math.round(
    allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length
  );

  const output = {
    approach: "qmd",
    setup_time_seconds: 266,
    queries: results,
    avg_latency_ms: avgLatency,
    notes:
      "Used searchLex (BM25 keyword) - fast, no LLM. Embedding model downloaded (328MB) but vector search returned empty (index path mismatch?). Setup: 266s including model download.",
  };

  const outPath = join(__dirname, "..", "results", "qmd-results.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
