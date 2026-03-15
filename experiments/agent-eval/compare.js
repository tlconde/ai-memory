#!/usr/bin/env node
/**
 * Compare agent-eval responses. Objective metrics only.
 * See METRICS.md for what each metric measures and its limitations.
 */
import { readFile, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(__dirname, "results");
const A_PATH = join(RESULTS, "agent-a-response.md");
const B_PATH = join(RESULTS, "agent-b-response.md");

const STOPWORDS = new Set(
  "the a an is are was were be been being have has had do does did will would could should may might must can to of in on at by for with about into through during".split(
    " "
  )
);

function wordCount(text) {
  return (text || "").split(/\s+/).filter(Boolean).length;
}

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

function extractSection(text, startPattern, endPattern) {
  const t = text || "";
  const start = t.search(new RegExp(startPattern, "i"));
  if (start < 0) return null;
  const rest = t.slice(start);
  const endMatch = rest.match(new RegExp(endPattern, "i"));
  const end = endMatch ? endMatch.index : rest.length;
  return rest.slice(0, end).trim();
}

/** Extract Iteration 1 content (friction list). */
function extractIter1(text) {
  return extractSection(text, "Iteration 1", "Iteration 2|## Iteration 2");
}

/** Extract Iteration 2 content (options). */
function extractIter2(text) {
  return extractSection(text, "Iteration 2", "CHECKPOINT|Iteration 3|## Iteration 3");
}

/** Extract Iteration 4 content (recommendation + steps). */
function extractIter4(text) {
  return extractSection(text, "Iteration 4|## Iteration 4", "Trace|## Trace|---");
}

/** Friction coverage: % of significant terms from iter1 that appear in iter4 recommendation. */
function frictionCoverage(text) {
  const iter1 = extractIter1(text);
  const iter4 = extractIter4(text);
  if (!iter1 || !iter4) return null;
  const terms1 = new Set(tokenize(iter1));
  const terms4 = new Set(tokenize(iter4));
  if (terms1.size === 0) return null;
  const overlap = [...terms1].filter((t) => terms4.has(t)).length;
  return { pct: Math.round((overlap / terms1.size) * 100), overlap, total: terms1.size };
}

/** Repetition: Jaccard similarity of word sets between iter1 and iter4. High = more overlap. */
function repetitionScore(text) {
  const iter1 = extractIter1(text);
  const iter4 = extractIter4(text);
  if (!iter1 || !iter4) return null;
  const set1 = new Set(tokenize(iter1));
  const set4 = new Set(tokenize(iter4));
  const intersection = [...set1].filter((w) => set4.has(w)).length;
  const union = new Set([...set1, ...set4]).size;
  if (union === 0) return null;
  return { jaccard: Math.round((intersection / union) * 100), intersection, union };
}

/** Completeness: presence of required sections. */
function completeness(text) {
  const t = text || "";
  return {
    has_friction: /friction|Friction/i.test(t) && /Iteration 1/i.test(t),
    has_options: /option|Option/i.test(t) && /Iteration 2/i.test(t),
    has_recommendation: /recommendation|Recommendation|recommend/i.test(t),
    has_steps: /\b\d+\.\s+\w+/.test(t) || /implementation steps/i.test(t),
  };
}

/** Recommendation specificity: numbered steps present. */
function recommendationSpecificity(text) {
  const iter4 = extractIter4(text);
  if (!iter4) return null;
  const numbered = (iter4.match(/\b\d+\.\s+/g) || []).length;
  return { numbered_steps: numbered };
}

/** Options-recommendation alignment: does iter4 mention options from iter2? */
function optionsAlignment(text) {
  const iter2 = extractIter2(text);
  const iter4 = extractIter4(text);
  if (!iter2 || !iter4) return null;
  const optionTerms = tokenize(iter2).filter((w) => w.length >= 4);
  const recTerms = new Set(tokenize(iter4));
  const mentioned = optionTerms.filter((t) => recTerms.has(t)).length;
  return {
    option_terms: optionTerms.length,
    mentioned_in_rec: mentioned,
    pct: optionTerms.length > 0 ? Math.round((mentioned / optionTerms.length) * 100) : 0,
  };
}

/** Self-contradiction heuristic: recommendation contains negation of recommendation. */
function selfContradiction(text) {
  const iter4 = extractIter4(text);
  if (!iter4) return null;
  const hasNegation = /\b(not|don't|avoid|against)\s+(recommend|use|do)/i.test(iter4);
  const hasRecommend = /recommend|recommendation/i.test(iter4);
  return { possible_contradiction: hasNegation && hasRecommend };
}

function hasTrace(text) {
  return /Trace|Step\s*\|\s*What\s*\|\s*Content|Iter\s*\|\s*Step/i.test(text || "");
}

function traceStepCount(text) {
  const rows = (text || "").match(/^\|\s*\d+\s*\|/gm);
  return rows ? rows.length : 0;
}

function usedMemory(text) {
  const t = text || "";
  if (/\bno\s+search_memory|without\s+search_memory|baseline\)/i.test(t)) return false;
  return /\bused\s+search_memory|search_memory\s+for|memory\/(decisions|patterns|debugging)/i.test(t);
}

function ranCompound(text) {
  const t = text || "";
  if (/skip.*compound|skips.*compound|agent b.*compound|does not run/i.test(t)) return false;
  return /ran\s+mem-compound|ran\s+\/mem-compound|executed.*compound|run\s+mem-compound/i.test(t);
}

function extractTokens(text) {
  const t = text || "";
  const matches = t.match(/(\d+)\s*tokens?|~(\d+)\s*tokens?|tokens?[:\s]+(\d+)|\|\s*~?(\d+)\s*\|/gi);
  if (!matches) return null;
  const nums = matches.flatMap((m) => (m.match(/\d+/) || [])).map(Number).filter((n) => n > 0 && n < 1000000);
  return nums.length ? { min: Math.min(...nums), max: Math.max(...nums), count: nums.length } : null;
}

function extractContextMentions(text) {
  const t = text || "";
  return t.match(/(\d+)\s*(KB|chars?|tokens?|files?)|~(\d+)\s*(KB|chars?|tokens?)|total\s+~?(\d+)/gi) || [];
}

function iterationCount(text) {
  const iters = (text || "").match(/\bIteration\s+[1-4]\b/gi);
  return iters ? new Set(iters).size : 0;
}

function computeMetrics(text, label) {
  const friction = frictionCoverage(text);
  const repetition = repetitionScore(text);
  const compl = completeness(text);
  const spec = recommendationSpecificity(text);
  const align = optionsAlignment(text);
  const contradict = selfContradiction(text);

  const completenessScore =
    [compl.has_friction, compl.has_options, compl.has_recommendation, compl.has_steps].filter(Boolean).length;

  return {
    words: wordCount(text),
    has_trace: hasTrace(text),
    trace_steps: traceStepCount(text),
    iterations: iterationCount(text),
    used_memory: usedMemory(text),
    ran_compound: ranCompound(text),
    tokens: extractTokens(text),
    context_mentions: extractContextMentions(text).length,

    friction_coverage: friction,
    repetition: repetition,
    completeness: compl,
    completeness_score: completenessScore,
    recommendation_specificity: spec,
    options_alignment: align,
    self_contradiction: contradict,
  };
}

async function main() {
  let a = "";
  let b = "";
  try {
    a = await readFile(A_PATH, "utf-8");
  } catch (e) {
    console.error("Missing agent-a-response.md. Run Agent A first.");
    process.exit(1);
  }
  try {
    b = await readFile(B_PATH, "utf-8");
  } catch (e) {
    console.error("Missing agent-b-response.md. Run Agent B first.");
    process.exit(1);
  }

  const metricsA = computeMetrics(a, "A");
  const metricsB = computeMetrics(b, "B");

  const report = {
    generated_at: new Date().toISOString(),
    "Agent A (ai-memory)": metricsA,
    "Agent B (baseline)": metricsB,
    comparison: {},
  };

  // Comparison (symmetric, no bias)
  report.comparison = {
    friction_coverage: {
      A: metricsA.friction_coverage?.pct ?? null,
      B: metricsB.friction_coverage?.pct ?? null,
      note: "Higher = recommendation addresses more friction terms from iter1. Interpret: does the agent's solution map to its problem statement?",
    },
    repetition_jaccard: {
      A: metricsA.repetition?.jaccard ?? null,
      B: metricsB.repetition?.jaccard ?? null,
      note: "Higher = more word overlap between iter1 and iter4. May indicate repetition (redundant) or consistency (coherent). Interpret in context.",
    },
    completeness_score: {
      A: metricsA.completeness_score,
      B: metricsB.completeness_score,
      note: "0-4. Sections present: friction, options, recommendation, steps.",
    },
    numbered_steps: {
      A: metricsA.recommendation_specificity?.numbered_steps ?? null,
      B: metricsB.recommendation_specificity?.numbered_steps ?? null,
      note: "Count of numbered implementation steps. More = more actionable.",
    },
    options_alignment_pct: {
      A: metricsA.options_alignment?.pct ?? null,
      B: metricsB.options_alignment?.pct ?? null,
      note: "% of iter2 option terms that appear in iter4 recommendation. Higher = recommendation aligns with proposed options.",
    },
    self_contradiction: {
      A: metricsA.self_contradiction?.possible_contradiction ?? false,
      B: metricsB.self_contradiction?.possible_contradiction ?? false,
      note: "Heuristic: recommendation section contains negation. May indicate confusion. Manual review if true.",
    },
  };

  // Console output
  console.log("\n=== Agent Eval Comparison ===\n");

  console.log("Agent A (ai-memory):");
  console.log(`  Words: ${metricsA.words} | Trace: ${metricsA.has_trace ? "yes" : "no"} (${metricsA.trace_steps} steps) | Iterations: ${metricsA.iterations}`);
  console.log(`  Used memory: ${metricsA.used_memory ? "yes" : "no"} | Ran compound: ${metricsA.ran_compound ? "yes" : "no"}`);
  console.log(`  Friction coverage: ${metricsA.friction_coverage?.pct ?? "?"}% (${metricsA.friction_coverage?.overlap ?? "?"}/${metricsA.friction_coverage?.total ?? "?"} terms)`);
  console.log(`  Repetition (Jaccard): ${metricsA.repetition?.jaccard ?? "?"}%`);
  console.log(`  Completeness: ${metricsA.completeness_score}/4 | Numbered steps: ${metricsA.recommendation_specificity?.numbered_steps ?? "?"}`);
  console.log(`  Options alignment: ${metricsA.options_alignment?.pct ?? "?"}%`);
  if (metricsA.self_contradiction?.possible_contradiction) console.log(`  ⚠ Possible self-contradiction (manual review)`);
  console.log("");

  console.log("Agent B (baseline):");
  console.log(`  Words: ${metricsB.words} | Trace: ${metricsB.has_trace ? "yes" : "no"} (${metricsB.trace_steps} steps) | Iterations: ${metricsB.iterations}`);
  console.log(`  Used memory: ${metricsB.used_memory ? "yes" : "no"} | Ran compound: ${metricsB.ran_compound ? "yes" : "no"}`);
  console.log(`  Friction coverage: ${metricsB.friction_coverage?.pct ?? "?"}% (${metricsB.friction_coverage?.overlap ?? "?"}/${metricsB.friction_coverage?.total ?? "?"} terms)`);
  console.log(`  Repetition (Jaccard): ${metricsB.repetition?.jaccard ?? "?"}%`);
  console.log(`  Completeness: ${metricsB.completeness_score}/4 | Numbered steps: ${metricsB.recommendation_specificity?.numbered_steps ?? "?"}`);
  console.log(`  Options alignment: ${metricsB.options_alignment?.pct ?? "?"}%`);
  if (metricsB.self_contradiction?.possible_contradiction) console.log(`  ⚠ Possible self-contradiction (manual review)`);
  console.log("");

  console.log("--- Comparison (interpret with METRICS.md) ---");
  console.log(JSON.stringify(report.comparison, null, 2));
  console.log("");

  await writeFile(join(RESULTS, "eval-report.json"), JSON.stringify(report, null, 2));
  console.log("Report: results/eval-report.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
