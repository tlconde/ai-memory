#!/usr/bin/env node
/**
 * QMD Approach A experiment for hybrid search.
 * Run: node run-qmd-experiment.mjs
 */

import { createStore } from '@tobilu/qmd';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TEST_DATA_AI = join(ROOT, 'test-data', '.ai');
const DB_PATH = join(__dirname, 'index.sqlite');
const RESULTS_PATH = join(ROOT, 'results', 'qmd-results.json');

const QUERIES = [
  { query: 'PostgreSQL connection pooling', expected: 'decisions.md' },
  { query: 'database connection management', expected: 'decisions.md' },
  { query: 'authentication strategy', expected: 'decisions.md' },
  { query: 'login and signup flow', expected: 'decisions.md' },
  { query: 'OOM memory leak', expected: 'debugging.md' },
];

function now() {
  return performance.now();
}

function elapsed(start) {
  return Math.round(performance.now() - start);
}

async function main() {
  const notes = [];
  let setupTimeSeconds = 0;

  console.log('QMD Experiment - Approach A');
  console.log('Test data:', TEST_DATA_AI);
  console.log('DB path:', DB_PATH);
  console.log('');

  const setupStart = now();
  console.log('Creating store...');
  const store = await createStore({
    dbPath: DB_PATH,
    config: {
      collections: {
        memory: {
          path: TEST_DATA_AI,
          pattern: '**/*.md',
        },
      },
    },
  });

  console.log('Store created. Running update (scan)...');
  const updateResult = await store.update({ collections: ['memory'] });
  console.log('Update:', updateResult);

  // Embed requires sqlite-vec extension (fails on some Windows builds). Skip and use BM25-only.
  let useHybrid = false;
  try {
    console.log('Running embed (first run may download models)...');
    await Promise.race([
      store.embed({ force: false }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('embed timeout 10s')), 10000)),
    ]);
    useHybrid = true;
    console.log('Embed done.');
  } catch (embedErr) {
    console.warn('Embed failed:', embedErr.message);
    notes.push(`BLOCKER: embed failed - ${embedErr.message}. Using searchLex (BM25 only).`);
  }
  setupTimeSeconds = Math.round(elapsed(setupStart) / 1000);

  const queryResults = [];

  for (const { query, expected } of QUERIES) {
    const latencyMs = [];
    let resultsPreview = [];
    let recall = false;

    for (let run = 0; run < 3; run++) {
      const start = now();
      // Use searchLex (BM25) if embed failed; otherwise full hybrid search
      const results = useHybrid
        ? await store.search({ query, limit: 5, rerank: true })
        : await store.searchLex(query, { limit: 5 });
      latencyMs.push(elapsed(start));

      if (run === 0) {
        resultsPreview = (results || []).slice(0, 5).map((r) => {
          const path = r.displayPath || r.path || r.filepath || r.docid || '?';
          const snippet = (r.snippet || r.text || r.content || '').slice(0, 80);
          return `${path}: ${snippet}...`;
        });
        const topPaths = (results || []).slice(0, 5).map((r) => {
          const p = r.displayPath || r.path || r.filepath || '';
          return p.split(/[/\\]/).pop() || '';
        });
        recall = topPaths.some((p) => p === expected);
      }
    }

    // top3_relevance: 3=exact, 2=related, 1=wrong, 0=no match (heuristic from recall + position)
    const top3Relevance = recall ? (resultsPreview[0]?.includes(expected) ? 3 : 2) : 0;
    queryResults.push({
      query,
      latency_ms: latencyMs,
      top3_relevance: top3Relevance,
      recall,
      results_preview: resultsPreview,
    });
    console.log(`Query "${query}": recall=${recall}, latencies=${latencyMs.join(',')}ms`);
  }

  await store.close();

  const allLatencies = queryResults.flatMap((q) => q.latency_ms);
  const avgLatencyMs = allLatencies.length
    ? Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length)
    : 0;

  const output = {
    approach: 'qmd',
    setup_time_seconds: setupTimeSeconds,
    queries: queryResults,
    avg_latency_ms: avgLatencyMs,
    notes: notes.join('; ') || 'QMD hybrid search with default embedding model',
  };

  writeFileSync(RESULTS_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log('');
  console.log('Results written to:', RESULTS_PATH);
  console.log('Setup time:', setupTimeSeconds, 's');
  console.log('Avg latency:', avgLatencyMs, 'ms');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
