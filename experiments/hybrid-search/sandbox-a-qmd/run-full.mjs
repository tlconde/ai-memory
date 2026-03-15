#!/usr/bin/env node
/**
 * Full QMD experiment: create local index, add collection, update, embed, run queries.
 * Uses searchLex (BM25) for fast results without additional model downloads.
 */
import { createStore } from "@tobilu/qmd";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SANDBOX = join(__dirname);
const TEST_DATA = join(__dirname, "..", "test-data", ".ai");
const DB_PATH = join(SANDBOX, "index.sqlite");

const QUERIES = [
  { query: "PostgreSQL connection pooling", expected: "decisions.md" },
  { query: "database connection management", expected: "decisions.md" },
  { query: "authentication strategy", expected: "decisions.md" },
  { query: "login and signup flow", expected: "decisions.md" },
  { query: "OOM memory leak", expected: "debugging.md" },
];

async function main() {
  let setupTime = 0;
  const setupStart = performance.now();

  const store = await createStore({
    dbPath: DB_PATH,
    config: {
      collections: {
        memory: { path: TEST_DATA, pattern: "**/*.md" },
      },
    },
  });

  console.log("Updating index...");
  const updateResult = await store.update();
  console.log("Update:", updateResult);

  // Skip embed - sqlite-vec may not be available on Windows. searchLex (BM25) works without it.
  try {
    const embedResult = await store.embed();
    console.log("Embed:", embedResult);
  } catch (e) {
    console.log("Embed skipped:", e.message);
  }

  setupTime = Math.round((performance.now() - setupStart) / 1000);
  console.log(`Setup time: ${setupTime}s`);

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
          const p = r.path || r.file || "";
          const s = (r.snippet || r.content || "").slice(0, 80);
          return `${p}: ${s}...`;
        });
      }
    }
    const hits = await store.searchLex(query, { limit: 5 });
    const recall = hits.some((r) => (r.path || r.file || "").includes(expected));
    results.push({ query, latency_ms: latencies, recall, results_preview: resultsPreview });
    console.log(`"${query}" → recall=${recall} ${latencies.join(",")}ms`);
  }

  await store.close();

  const allLatencies = results.flatMap((r) => r.latency_ms);
  const avgLatency = Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length);

  const output = {
    approach: "qmd",
    setup_time_seconds: setupTime,
    queries: results,
    avg_latency_ms: avgLatency,
    notes:
      "Used searchLex (BM25 keyword). Local index in sandbox. First run downloads embedding model (~328MB) for embed step.",
  };

  const outPath = join(__dirname, "..", "results", "qmd-results.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
