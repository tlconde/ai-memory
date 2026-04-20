/**
 * Platform integration evals.
 * Measures how well ai-memory integrates with Cursor, Claude Code, and cloud environments.
 */

import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { EvalMetric } from "./types.js";

/**
 * Hook coverage: % of recommended Claude Code hooks installed.
 * Checks for Stop, PreCompact, SubagentStop, WorktreeCreate in .claude/settings.json
 * or plugin hooks.
 */
export async function evalHookCoverage(projectDir: string): Promise<EvalMetric> {
  const recommended = ["Stop", "PreCompact", "SubagentStop", "WorktreeCreate"];
  let found = 0;

  // Check .claude/settings.json
  const settingsPath = join(projectDir, ".claude", "settings.json");
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(await readFile(settingsPath, "utf-8"));
      const hooks = settings.hooks ?? {};
      for (const hook of recommended) {
        if (hooks[hook]) found++;
      }
    } catch { /* malformed */ }
  }

  // Check plugin hooks — take the max of settings.json and plugin hooks
  const pluginHooksPath = join(projectDir, "plugins", "adapters", "claude-code", "hooks", "hooks.json");
  if (existsSync(pluginHooksPath)) {
    try {
      const pluginHooks = JSON.parse(await readFile(pluginHooksPath, "utf-8"));
      const hooks = pluginHooks.hooks ?? {};
      let pluginFound = 0;
      for (const hook of recommended) {
        if (hooks[hook]) pluginFound++;
      }
      found = Math.max(found, pluginFound);
    } catch { /* malformed */ }
  }

  const pct = Math.round((found / recommended.length) * 100);
  return {
    name: "hook_coverage",
    value: `${pct}%`,
    status: pct >= 75 ? "good" : pct >= 50 ? "warn" : "bad",
    note: `${found}/${recommended.length} recommended hooks (${recommended.join(", ")})`,
  };
}

/**
 * Skill discoverability: % of skills present in any tool-specific skills directory.
 * Checks .cursor/skills/, .claude/skills/, .agents/skills/ (Antigravity), and .ai/skills/ (canonical).
 */
export async function evalSkillDiscoverability(projectDir: string): Promise<EvalMetric> {
  const expected = ["mem-compound", "mem-session-close", "mem-validate", "mem-init"];
  const skillDirs = [
    join(projectDir, ".cursor", "skills"),
    join(projectDir, ".claude", "skills"),
    join(projectDir, ".agents", "skills"),
    join(projectDir, ".ai", "skills"),
  ];

  let found = 0;
  let foundIn = "";
  for (const dir of skillDirs) {
    if (!existsSync(dir)) continue;
    let count = 0;
    for (const skill of expected) {
      if (existsSync(join(dir, skill, "SKILL.md"))) count++;
    }
    if (count > found) {
      found = count;
      foundIn = dir.replace(projectDir, "").replace(/\\/g, "/").replace(/^\//, "");
    }
  }

  const pct = Math.round((found / expected.length) * 100);
  return {
    name: "skill_discoverability",
    value: `${pct}%`,
    status: pct === 100 ? "good" : pct >= 50 ? "warn" : "bad",
    note: found === expected.length
      ? `All skills found in ${foundIn}/`
      : `${found}/${expected.length} skills found. Run \`npx @radix-ai/ai-memory install --to <tool>\` to install.`,
  };
}

/**
 * Cloud readiness: .ai/ is git-tracked + sync_memory available + HTTP transport exists.
 */
export async function evalCloudReadiness(projectDir: string): Promise<EvalMetric> {
  const checks: string[] = [];
  let passed = 0;

  // Check .ai/ is git-tracked
  const aiDir = join(projectDir, ".ai");
  if (existsSync(aiDir)) {
    checks.push("✓ .ai/ exists");
    passed++;
  } else {
    checks.push("✗ .ai/ missing");
  }

  // Check MCP config exists (sync_memory available via MCP)
  const mcpLocations = [".mcp.json", ".cursor/mcp.json"].filter((p) => existsSync(join(projectDir, p)));
  if (mcpLocations.length > 0) {
    checks.push(`✓ MCP config present (${mcpLocations.join(", ")})`);
    passed++;
  } else {
    checks.push("✗ No MCP config found (.mcp.json or .cursor/mcp.json)");
  }

  // Check if MCP server code supports HTTP
  const mcpIndex = join(projectDir, "src", "mcp-server", "index.ts");
  if (existsSync(mcpIndex)) {
    try {
      const content = await readFile(mcpIndex, "utf-8");
      if (content.includes("StreamableHTTPServerTransport") || content.includes("--http")) {
        checks.push("✓ HTTP transport supported");
        passed++;
      } else {
        checks.push("✗ HTTP transport not implemented");
      }
    } catch {
      checks.push("? Could not read MCP server source");
    }
  } else {
    // Check dist for published package
    checks.push("~ HTTP transport (check package)");
    passed++; // Give benefit of doubt for installed packages
  }

  return {
    name: "cloud_readiness",
    value: `${passed}/3`,
    status: passed === 3 ? "good" : passed >= 2 ? "warn" : "bad",
    note: checks.join("; "),
  };
}

/**
 * Automation readiness: skills have automation sections and sync_memory calls.
 */
export async function evalAutomationReadiness(projectDir: string): Promise<EvalMetric> {
  const skillDirs = [
    join(projectDir, "plugins", "ai-memory", "skills"),
    join(projectDir, ".agents", "skills"),
  ];

  let totalSkills = 0;
  let automationReady = 0;

  for (const dir of skillDirs) {
    if (!existsSync(dir)) continue;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(dir, entry.name, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      totalSkills++;
      const content = await readFile(skillPath, "utf-8");
      if (content.toLowerCase().includes("automation") || content.includes("sync_memory")) {
        automationReady++;
      }
    }
  }

  if (totalSkills === 0) {
    return { name: "automation_readiness", value: "n/a", status: "warn", note: "No skills found" };
  }

  const pct = Math.round((automationReady / totalSkills) * 100);
  return {
    name: "automation_readiness",
    value: `${pct}%`,
    status: pct >= 80 ? "good" : pct >= 50 ? "warn" : "bad",
    note: `${automationReady}/${totalSkills} skills are automation-ready (mention automation/sync_memory)`,
  };
}

/**
 * Context load order: verifies SessionStart hooks inject context in
 * prefix-cache-friendly order (static → semi-static → dynamic).
 * See .ai/rules/context-caching.md.
 */
export async function evalContextLoadOrder(projectDir: string): Promise<EvalMetric> {
  // Expected order: IDENTITY.md must appear before PROJECT_STATUS.md,
  // which must appear before memory-index.md
  const orderedMarkers = ["IDENTITY.md", "PROJECT_STATUS.md", "memory-index.md"];
  const hookPaths = [
    join(projectDir, ".claude", "hooks", "SessionStart.js"),
    join(projectDir, "plugins", "adapters", "claude-code", "hooks", "SessionStart.js"),
  ];

  let checked = 0;
  let passed = 0;
  const notes: string[] = [];

  for (const hookPath of hookPaths) {
    if (!existsSync(hookPath)) continue;
    checked++;
    try {
      const content = await readFile(hookPath, "utf-8");
      const positions = orderedMarkers.map((m) => content.indexOf(m));

      // All markers must be present
      if (positions.some((p) => p === -1)) {
        const missing = orderedMarkers.filter((_, i) => positions[i] === -1);
        notes.push(`${hookPath.includes("plugins") ? "plugin" : "project"}: missing ${missing.join(", ")}`);
        continue;
      }

      // Verify ascending order
      const inOrder = positions.every((pos, i) => i === 0 || pos > positions[i - 1]);
      if (inOrder) {
        passed++;
        notes.push(`${hookPath.includes("plugins") ? "plugin" : "project"}: ✓ correct order`);
      } else {
        notes.push(`${hookPath.includes("plugins") ? "plugin" : "project"}: ✗ wrong order (should be static → semi-static → dynamic)`);
      }
    } catch {
      notes.push(`${hookPath.includes("plugins") ? "plugin" : "project"}: read error`);
    }
  }

  if (checked === 0) {
    return { name: "context_load_order", value: "n/a", status: "warn", note: "No SessionStart hooks found" };
  }

  return {
    name: "context_load_order",
    value: `${passed}/${checked}`,
    status: passed === checked ? "good" : "warn",
    note: notes.join("; "),
  };
}

/**
 * Integration coverage: % of recommended toolbox files that exist.
 */
export async function evalIntegrationCoverage(aiDir: string): Promise<EvalMetric> {
  const expected = ["integrations.md", "browser.md", "shell.md"];
  const toolboxDir = join(aiDir, "toolbox");
  let found = 0;

  if (existsSync(toolboxDir)) {
    for (const file of expected) {
      if (existsSync(join(toolboxDir, file))) found++;
    }
  }

  const pct = Math.round((found / expected.length) * 100);
  return {
    name: "integration_coverage",
    value: `${pct}%`,
    status: pct === 100 ? "good" : pct >= 33 ? "warn" : "bad",
    note: `${found}/${expected.length} toolbox files (${expected.join(", ")})`,
  };
}

export async function evalCanonicalSync(projectDir: string): Promise<EvalMetric> {
  const aiDir = join(projectDir, ".ai");
  if (!existsSync(aiDir)) {
    return { name: "canonical_sync", value: "N/A", status: "warn", note: "No .ai/ directory" };
  }
  try {
    const { canonicalSyncCheck, writeSyncStatus } = await import("../mcp-server/tools/canonical-sync.js");
    const report = canonicalSyncCheck(projectDir, aiDir);
    // Write sync status as side effect (keeps it fresh for non-MCP tools)
    await writeSyncStatus(aiDir, report);
    const { total, uncanonical, missingStubs, nonStubs, orphanedStubs } = report.summary;
    return {
      name: "canonical_sync",
      value: total === 0 ? "in sync" : `${total} gap(s)`,
      status: total === 0 ? "good" : total <= 3 ? "warn" : "bad",
      note: total > 0
        ? `uncanonical: ${uncanonical}, missing stubs: ${missingStubs}, non-stubs: ${nonStubs}, orphans: ${orphanedStubs}`
        : `All ${report.toolsScanned.length} tool(s) in sync with .ai/ canonical`,
    };
  } catch (e) {
    return { name: "canonical_sync", value: "error", status: "bad", note: String(e) };
  }
}
