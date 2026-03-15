#!/usr/bin/env node
import { createStore } from "@tobilu/qmd";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "index.sqlite");

const QUERIES = [
  { query: "PostgreSQL connection pooling", expected: "decisions.md" },
  { query: "database connection management", expected: "decisions.md" },
  { query: "authentication strategy", expected: "decisions.md" },
  { query: "login and signup flow", expected: "decisions.md" },
  { query: "OOM memory leak", expected: "debugging.md" },
];

async function main() {
  const store = await createStore({
    dbPath: DB_PATH,
    config: {
      collections: {
        memory: {
          path: join(__dirname, "..", "test-data", ".ai"),
          pattern: "**/*.md",
        },
      },
    },
  });

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
          const p = r.filepath || r.displayPath || r.path || "";
          const s = (r.snippet || r.body || r.content || "").slice(0, 80);
          return `${p}: ${s}...`;
        });
      }
    }
    const hits = await store.searchLex(query, { limit: 5 });
    const recall = hits.some((r) => (r.filepath || r.displayPath || r.path || "").includes(expected));
    results.push({ query, latency_ms: latencies, recall, results_preview: resultsPreview });
    console.log(`"${query}" → recall=${recall} ${latencies.join(",")}ms`);
  }

  await store.close();

  const allLatencies = results.flatMap((r) => r.latency_ms);
  const avgLatency = Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length);

  const output = {
    approach: "qmd",
    setup_time_seconds: 266,
    queries: results,
    avg_latency_ms: avgLatency,
    notes:
      "Used searchLex (BM25). Setup 266s (from initial embed run). sqlite-vec unavailable on Windows - vector/embed skipped. BM25 FTS works.",
  };

  const outPath = join(__dirname, "..", "results", "qmd-results.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
