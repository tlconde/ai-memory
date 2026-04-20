/**
 * Search quality eval: measures hybrid search advantage over keyword-only.
 *
 * Runs each test case in BOTH keyword and hybrid modes, then reports:
 * - Overall recall (does search find the right file?)
 * - Semantic advantage (what hybrid finds that keyword misses)
 * - Regression check (what keyword finds that hybrid misses — indicates RRF tuning issues)
 */

import { existsSync } from "fs";
import { join } from "path";
import { hybridSearch } from "../hybrid-search/index.js";
import type { EvalMetric } from "./types.js";

interface SearchTestCase {
  /** Query phrased differently than how the entry is stored */
  query: string;
  /** File that MUST appear in results */
  expectedFile: string;
  /** "shared" = query shares terms with stored text. "zero" = no shared terms. */
  overlap: "shared" | "zero";
  /** Human-readable description */
  description: string;
}

/**
 * Test cases split into two tiers:
 * - shared: query and stored text share keywords. Both modes should find these.
 * - zero: query uses completely different vocabulary. Only semantic should find these.
 *
 * "Zero overlap" means: no non-stopword token in the query appears in the target entry.
 * We verified this by checking keyword search misses them.
 */
const TEST_CASES: SearchTestCase[] = [
  // Tier 1: shared terms — baseline sanity (both modes should pass)
  {
    query: "project learnings go to .ai/memory",
    expectedFile: "IDENTITY.md",
    overlap: "shared",
    description: "Shared: IDENTITY.md via 'project learnings .ai/memory'",
  },
  {
    query: "don't overwrite user files during installation",
    expectedFile: "decisions.md",
    overlap: "shared",
    description: "Shared: decisions.md via 'overwrite install'",
  },
  // Tier 2: zero overlap — semantic advantage
  // These use vocabulary that does NOT appear in the target files.
  {
    query: "where to store reusable institutional wisdom",
    expectedFile: "IDENTITY.md",
    overlap: "zero",
    description: "Zero: IDENTITY.md (no shared terms with 'Project Memory is Canonical')",
  },
  {
    query: "preventing accidental clobbering of handcrafted configuration",
    expectedFile: "decisions.md",
    overlap: "zero",
    description: "Zero: decisions.md (no shared terms with 'Install must never overwrite')",
  },
  {
    query: "disposable workspace for verifying command output",
    expectedFile: "patterns.md",
    overlap: "zero",
    description: "Zero: patterns.md (no shared terms with 'sandboxed testing')",
  },
];

function resultContainsFile(
  results: Array<{ file: string }>,
  expectedFile: string
): boolean {
  return results.some(
    (r) =>
      r.file.toLowerCase().includes(expectedFile.toLowerCase())
  );
}

export async function evalSemanticRecall(aiDir: string): Promise<EvalMetric> {
  const memDir = join(aiDir, "memory");
  if (!existsSync(memDir)) {
    return { name: "Semantic recall", value: "N/A", status: "warn", note: "No memory/ directory" };
  }

  // Run every test case in both modes
  const kwResults: boolean[] = [];
  const hybridResults: boolean[] = [];
  const zeroOverlapIndices: number[] = [];

  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i];
    if (tc.overlap === "zero") zeroOverlapIndices.push(i);

    let kwFound = false;
    let hyFound = false;

    try {
      const kw = await hybridSearch(aiDir, tc.query, { mode: "keyword", limit: 5 });
      kwFound = resultContainsFile(kw.results, tc.expectedFile);
    } catch { /* keyword search failed */ }

    try {
      const hy = await hybridSearch(aiDir, tc.query, { mode: "hybrid", limit: 5 });
      hyFound = resultContainsFile(hy.results, tc.expectedFile);
    } catch { /* hybrid search failed */ }

    kwResults.push(kwFound);
    hybridResults.push(hyFound);
  }

  // Calculate metrics
  const total = TEST_CASES.length;
  const kwPassed = kwResults.filter(Boolean).length;
  const hyPassed = hybridResults.filter(Boolean).length;

  // Semantic advantage: cases where hybrid found it but keyword didn't
  const semanticWins: string[] = [];
  // Regressions: cases where keyword found it but hybrid didn't
  const regressions: string[] = [];

  for (let i = 0; i < total; i++) {
    if (hybridResults[i] && !kwResults[i]) {
      semanticWins.push(TEST_CASES[i].description);
    }
    if (kwResults[i] && !hybridResults[i]) {
      regressions.push(TEST_CASES[i].description);
    }
  }

  // Zero-overlap-specific stats
  const zeroTotal = zeroOverlapIndices.length;
  const zeroKw = zeroOverlapIndices.filter((i) => kwResults[i]).length;
  const zeroHy = zeroOverlapIndices.filter((i) => hybridResults[i]).length;

  // Build output
  const parts: string[] = [
    `keyword: ${kwPassed}/${total}`,
    `hybrid: ${hyPassed}/${total}`,
    `zero-overlap: kw=${zeroKw}/${zeroTotal} hy=${zeroHy}/${zeroTotal}`,
  ];
  if (semanticWins.length > 0) {
    parts.push(`semantic advantage: +${semanticWins.length}`);
  }

  const notes: string[] = [];
  if (semanticWins.length > 0) {
    notes.push(`Semantic wins: ${semanticWins.join("; ")}`);
  }
  if (regressions.length > 0) {
    notes.push(`Regressions (hybrid missed, keyword found): ${regressions.join("; ")}`);
  }
  if (hyPassed < total) {
    const missed = TEST_CASES.filter((_, i) => !hybridResults[i]).map((tc) => tc.description);
    notes.push(`Hybrid missed: ${missed.join("; ")}`);
  }

  // Status: good if hybrid beats keyword on zero-overlap, warn if tied, bad if keyword wins
  let status: "good" | "warn" | "bad";
  if (zeroHy > zeroKw) {
    status = "good";
  } else if (zeroHy === zeroKw && hyPassed >= kwPassed) {
    status = hyPassed === total ? "good" : "warn";
  } else {
    status = regressions.length > 0 ? "bad" : "warn";
  }

  return {
    name: "Semantic recall",
    value: parts.join(" | "),
    status,
    note: notes.length > 0 ? notes.join(". ") : undefined,
  };
}
