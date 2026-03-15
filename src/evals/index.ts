import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { join, resolve } from "path";
import { existsSync } from "fs";
import type { EvalMetric } from "./types.js";

export type { EvalMetric } from "./types.js";

export interface EvalReport {
  generated_at: string;
  ai_dir: string;
  metrics: EvalMetric[];
}

// Run all built-in evals + any custom evals in temp/custom-evals/
export async function runEvals(aiDir: string): Promise<EvalReport> {
  const metrics: EvalMetric[] = [];

  // 1. Rule coverage: % of P0 entries with constraint_pattern
  metrics.push(await evalRuleCoverage(aiDir));

  // 2. Memory freshness: days since last compound (last_updated in memory-index.md)
  metrics.push(await evalSessionCadence(aiDir));

  // 3. Index coverage: % of .md files with valid frontmatter
  metrics.push(await evalIndexCoverage(aiDir));

  // 4. Open items count
  metrics.push(await evalOpenItems(aiDir));

  // 5. Deprecated entry ratio
  metrics.push(await evalDeprecatedRatio(aiDir));

  // 6. Recall test pass rate (Full tier only)
  if (existsSync(join(aiDir, "temp/rule-tests/tests.json"))) {
    metrics.push(await evalRuleTests(aiDir));
  }

  // 7. Adoption signals (memory effectiveness)
  const { evalMemoryDepth, evalSessionCount, evalMemoryFreshness } =
    await import("./performance-comparison.js");
  metrics.push(await evalMemoryDepth(aiDir));
  metrics.push(await evalSessionCount(aiDir));
  metrics.push(await evalMemoryFreshness(aiDir));

  // 8. Platform integration
  const { evalHookCoverage, evalSkillDiscoverability, evalCloudReadiness, evalAutomationReadiness, evalIntegrationCoverage } =
    await import("./platform-integration.js");
  const projectDir = resolve(aiDir, "..");
  metrics.push(await evalHookCoverage(projectDir));
  metrics.push(await evalSkillDiscoverability(projectDir));
  metrics.push(await evalCloudReadiness(projectDir));
  metrics.push(await evalAutomationReadiness(projectDir));
  metrics.push(await evalIntegrationCoverage(aiDir));

  // Load custom evals from temp/custom-evals/
  const customEvalsDir = join(aiDir, "temp/custom-evals");
  if (existsSync(customEvalsDir)) {
    const entries = await readdir(customEvalsDir);
    for (const file of entries) {
      if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;
      try {
        const mod = await import(join(customEvalsDir, file));
        if (typeof mod.evaluate === "function") {
          const result = await mod.evaluate(aiDir);
          metrics.push(result);
        }
      } catch {
        metrics.push({
          name: file,
          value: "error",
          status: "bad",
          note: "Failed to load custom eval",
        });
      }
    }
  }

  const report: EvalReport = {
    generated_at: new Date().toISOString(),
    ai_dir: aiDir,
    metrics,
  };

  // Write report to temp/
  const tempDir = join(aiDir, "temp");
  await mkdir(tempDir, { recursive: true });
  await writeFile(join(tempDir, "eval-report.json"), JSON.stringify(report, null, 2));

  // Append to history
  const historyPath = join(tempDir, "eval-history.jsonl");
  const line = JSON.stringify({ ...report, metrics: undefined, summary: metrics.map((m) => ({ n: m.name, v: m.value, s: m.status })) });
  await appendLine(historyPath, line);

  return report;
}

async function appendLine(filePath: string, line: string): Promise<void> {
  try {
    const existing = existsSync(filePath) ? await readFile(filePath, "utf-8") : "";
    await writeFile(filePath, existing + line + "\n");
  } catch {
    // non-fatal
  }
}

async function safeRead(filePath: string): Promise<string> {
  try { return await readFile(filePath, "utf-8"); } catch { return ""; }
}

// ─── Built-in eval functions ──────────────────────────────────────────────────

async function evalRuleCoverage(aiDir: string): Promise<EvalMetric> {
  const { readP0Entries } = await import("../governance/p0-parser.js");
  const entries = await readP0Entries(aiDir);
  if (entries.length === 0) {
    return { name: "Rule coverage", value: "N/A", status: "warn", note: "No [P0] entries found" };
  }
  const withPattern = entries.filter((e) => e.constraint_pattern !== undefined).length;
  const pct = Math.round((withPattern / entries.length) * 100);
  return {
    name: "Rule coverage",
    value: `${pct}% (${withPattern}/${entries.length} P0 entries have constraint_pattern)`,
    status: pct >= 80 ? "good" : pct >= 40 ? "warn" : "bad",
    note: pct < 80 ? "Add constraint_pattern to more [P0] entries for automated enforcement" : undefined,
  };
}

async function evalSessionCadence(aiDir: string): Promise<EvalMetric> {
  const archive = await safeRead(join(aiDir, "sessions/archive/thread-archive.md"));
  const dateMatches = archive.match(/\[(\d{4}-\d{2}-\d{2})\]/g);
  if (!dateMatches || dateMatches.length === 0) {
    return { name: "Session cadence", value: "No sessions recorded", status: "warn" };
  }
  const lastDateStr = dateMatches[dateMatches.length - 1].slice(1, -1);
  const lastDate = new Date(lastDateStr);
  const daysSince = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
  return {
    name: "Session cadence",
    value: `${daysSince} day(s) since last session`,
    status: daysSince <= 7 ? "good" : daysSince <= 30 ? "warn" : "bad",
    note: daysSince > 7 ? "Consider running /mem-compound soon" : undefined,
  };
}

async function evalIndexCoverage(aiDir: string): Promise<EvalMetric> {
  const { validateAll } = await import("../formatter/index.js");
  const errors = await validateAll(aiDir);

  // Count total files
  let total = 0;
  async function count(dir: string): Promise<void> {
    if (!existsSync(dir)) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) await count(join(dir, e.name));
      else if (e.name.endsWith(".md")) total++;
    }
  }
  await count(aiDir);

  const invalid = new Set(errors.map((e) => e.file)).size;
  const valid = total - invalid;
  const pct = total === 0 ? 100 : Math.round((valid / total) * 100);
  return {
    name: "Frontmatter coverage",
    value: `${pct}% (${valid}/${total} files valid)`,
    status: pct === 100 ? "good" : pct >= 80 ? "warn" : "bad",
    note: invalid > 0 ? `Run \`ai-memory fmt\` to fix ${invalid} file(s)` : undefined,
  };
}

async function evalOpenItems(aiDir: string): Promise<EvalMetric> {
  const content = await safeRead(join(aiDir, "sessions/open-items.md"));
  const open = (content.match(/^- \[ \]/gm) ?? []).length;
  const closed = (content.match(/^- \[x\]/gm) ?? []).length;
  return {
    name: "Open items",
    value: `${open} open, ${closed} closed`,
    status: open <= 5 ? "good" : open <= 15 ? "warn" : "bad",
  };
}

async function evalDeprecatedRatio(aiDir: string): Promise<EvalMetric> {
  const memDir = join(aiDir, "memory");
  let total = 0;
  let deprecated = 0;

  if (existsSync(memDir)) {
    const files = await readdir(memDir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const content = await safeRead(join(memDir, file));
      const entries = (content.match(/^### \[P[0-2]\]/gm) ?? []).length;
      const deps = (content.match(/\[DEPRECATED\]/g) ?? []).length;
      total += entries;
      deprecated += deps;
    }
  }

  if (total === 0) return { name: "Deprecated entries", value: "N/A", status: "good" };
  const pct = Math.round((deprecated / total) * 100);
  return {
    name: "Deprecated entries",
    value: `${pct}% (${deprecated}/${total})`,
    status: pct <= 10 ? "good" : pct <= 25 ? "warn" : "bad",
    note: pct > 25 ? "Run \`ai-memory prune\` to archive stale entries" : undefined,
  };
}

async function evalRuleTests(aiDir: string): Promise<EvalMetric> {
  // Check if all rule tests are referenced by a rule in harness.json
  const testsPath = join(aiDir, "temp/rule-tests/tests.json");
  const harnessPath = join(aiDir, "temp/harness.json");
  try {
    const tests = JSON.parse(await readFile(testsPath, "utf-8")) as Array<{ rule_id: string }>;
    const rules = JSON.parse(await readFile(harnessPath, "utf-8")) as Array<{ id: string }>;
    const ruleIds = new Set(rules.map((r) => r.id));
    const orphaned = tests.filter((t) => !ruleIds.has(t.rule_id)).length;
    return {
      name: "Rule tests",
      value: `${tests.length} test(s), ${orphaned} orphaned`,
      status: orphaned === 0 ? "good" : "warn",
      note: orphaned > 0 ? "Some tests reference rules that no longer exist in harness.json" : undefined,
    };
  } catch {
    return { name: "Rule tests", value: "error reading", status: "bad" };
  }
}
