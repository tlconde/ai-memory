/**
 * Tool inspection and sync for ai-memory install targets.
 * Detects installed tools, reads their config, and syncs rules/skills/MCP.
 */

import { existsSync } from "fs";
import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getDetectedToolsWithPaths, scanExistingFiles, scanRootFilesHeuristic } from "../../cli/environment.js";
import { textResponse, type McpResponse } from "./shared.js";

// ─── Interfaces ───────────────────────────────────────────────────────────

export interface ToolConfig {
  rules: string[];
  skills: string[];
  mcpServers: Record<string, unknown>;
}

export interface DetectedTool {
  id: string;
  name: string;
  paths: string[];
}

// ─── Tool path mappings ───────────────────────────────────────────────────
// Matches TOOL_ADAPTERS (adapters.ts) and ENV_MCP_PATHS (environment.ts)

export const TOOL_PATH_MAPPINGS: Record<
  string,
  { rulesDir: string | null; rulesPath?: string; skillsDir: string | null; mcpPath: string | null }
> = {
  cursor: {
    rulesDir: ".cursor/rules",
    skillsDir: ".cursor/skills",
    mcpPath: ".cursor/mcp.json",
  },
  "claude-code": {
    rulesDir: null,
    skillsDir: ".claude/skills",
    mcpPath: ".mcp.json",
  },
  antigravity: {
    rulesDir: ".agents/rules",
    skillsDir: ".agents/skills",
    mcpPath: null, // Antigravity uses global MCP config, not project-level
  },
  // windsurf: {
  //   rulesDir: null,
  //   rulesPath: ".windsurfrules",
  //   skillsDir: null,
  //   mcpPath: ".mcp.json",
  // },
  // cline: {
  //   rulesDir: null,
  //   rulesPath: ".clinerules",
  //   skillsDir: null,
  //   mcpPath: ".mcp.json",
  // },
};

// ─── Internal helpers ─────────────────────────────────────────────────────

/**
 * Reads rules directory for a tool. Returns .mdc and .md file names.
 */
async function parseRulesDir(toolId: string, projectRoot: string): Promise<string[]> {
  const mapping = TOOL_PATH_MAPPINGS[toolId];
  const rulesDir = mapping?.rulesDir;
  if (rulesDir == null) return [];
  const absPath = join(projectRoot, rulesDir);
  if (!existsSync(absPath)) return [];
  const entries = await readdir(absPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && (e.name.endsWith(".mdc") || e.name.endsWith(".md")))
    .map((e) => e.name);
}

/**
 * Detects which AI tools are installed in the project.
 */
export function detectTools(projectRoot: string): DetectedTool[] {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  return getDetectedToolsWithPaths(projectRoot, packageRoot);
}

/**
 * Reads skills directory for a tool. Returns subdir names that contain SKILL.md.
 */
export async function parseSkillsDir(toolId: string, projectRoot: string): Promise<string[]> {
  const mapping = TOOL_PATH_MAPPINGS[toolId];
  const skillsDir = mapping?.skillsDir;
  if (skillsDir == null) return [];
  const absPath = join(projectRoot, skillsDir);
  if (!existsSync(absPath)) return [];
  const entries = await readdir(absPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && existsSync(join(absPath, e.name, "SKILL.md")))
    .map((e) => e.name);
}

/**
 * Reads MCP config for a tool. Returns mcpServers object or {} if missing.
 */
export async function parseMcpConfig(
  toolId: string,
  projectRoot: string
): Promise<Record<string, unknown>> {
  const mapping = TOOL_PATH_MAPPINGS[toolId];
  const mcpPath = mapping?.mcpPath;
  if (mcpPath == null) return {};
  const absPath = join(projectRoot, mcpPath);
  if (!existsSync(absPath)) return {};
  try {
    const raw = await readFile(absPath, "utf-8");
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    return parsed.mcpServers ?? {};
  } catch {
    return {};
  }
}

/**
 * Diffs canonical skills vs tool skills.
 * missing = skills in canonical but not in tool
 * outdated = [] for now (simplified)
 */
export function diffSkills(
  canonicalSkills: string[],
  toolSkills: string[]
): { missing: string[]; outdated: string[] } {
  const missing = canonicalSkills.filter((s) => !toolSkills.includes(s));
  return { missing, outdated: [] };
}

/**
 * Reads tool config (rules, skills, mcpServers) for a given tool.
 */
export async function readToolConfig(
  projectRoot: string,
  toolId: string
): Promise<ToolConfig | null> {
  const mapping = TOOL_PATH_MAPPINGS[toolId];
  if (!mapping) return null;
  const [rules, skills, mcpServers] = await Promise.all([
    parseRulesDir(toolId, projectRoot),
    parseSkillsDir(toolId, projectRoot),
    parseMcpConfig(toolId, projectRoot),
  ]);
  return { rules, skills, mcpServers };
}

export interface SyncToolsOptions {
  write?: boolean;
}

/**
 * Syncs ai-memory skills to detected tools.
 * Reads canonical skills from .ai/skills/, diffs against each tool's skills,
 * and optionally writes missing skills to tool dirs (e.g. .cursor/skills/).
 * Writes ONLY to tool dirs, never to .ai/ immutable paths.
 */
export async function syncTools(
  projectRoot: string,
  aiDir: string,
  options: SyncToolsOptions = {}
): Promise<McpResponse> {
  const { write = false } = options;

  const tools = detectTools(projectRoot);
  const skillsRoot = join(aiDir, "skills");
  if (!existsSync(skillsRoot)) {
    return textResponse("No .ai/skills/ directory found.");
  }

  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const canonicalSkills = entries
    .filter((e) => e.isDirectory() && existsSync(join(skillsRoot, e.name, "SKILL.md")))
    .map((e) => e.name);

  const lines: string[] = [];
  for (const tool of tools) {
    const mapping = TOOL_PATH_MAPPINGS[tool.id];
    const skillsDir = mapping?.skillsDir;
    if (skillsDir == null) continue;

    const config = await readToolConfig(projectRoot, tool.id);
    if (!config) continue;

    const { missing } = diffSkills(canonicalSkills, config.skills);
    const toolSkillsPath = join(projectRoot, skillsDir);

    if (missing.length === 0) {
      lines.push(`${tool.name}: up to date`);
      continue;
    }

    lines.push(`${tool.name}: missing ${missing.length} skill(s): ${missing.join(", ")}`);

    if (write) {
      for (const name of missing) {
        const srcPath = join(skillsRoot, name, "SKILL.md");
        if (!existsSync(srcPath)) continue;
        const content = await readFile(srcPath, "utf-8");
        const destDir = join(toolSkillsPath, name);
        await mkdir(destDir, { recursive: true });
        await writeFile(join(destDir, "SKILL.md"), content, "utf-8");
      }
      lines.push(`  → wrote ${missing.length} skill(s) to ${skillsDir}`);
    }
  }

  return textResponse(lines.length > 0 ? lines.join("\n") : "No tools with skillsDir detected.");
}

// ─── Migration scan (MCP-exposed) ──────────────────────────────────────────

/**
 * Scans for existing tool files that may need migration to .ai/ canonical.
 * Used by mem-init skill Step 6 to present migration proposals.
 *
 * Runs two parallel layers:
 *   Layer 1 — Broad: scans entire tool directories, excludes ai-memory managed files
 *   Layer 2 — Precise + heuristic: checks known root files and AI-instruction patterns
 *
 * Returns structured results for the LLM to present as migration proposals.
 */
export function scanForMigration(projectRoot: string): McpResponse {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

  // Layer 1 + Layer 2 known files (from environment-specs.json)
  const scanResults = scanExistingFiles(projectRoot, packageRoot);

  // Layer 2 heuristic: root *.md files with AI-instruction patterns
  const heuristicFiles = scanRootFilesHeuristic(projectRoot);

  if (scanResults.length === 0 && heuristicFiles.length === 0) {
    return textResponse("No existing tool files found that need migration.");
  }

  const lines: string[] = ["# Migration Scan Results\n"];

  for (const scan of scanResults) {
    lines.push(`## ${scan.toolName} (${scan.toolId})\n`);

    if (scan.files.length > 0) {
      // Group by category
      const byCategory = new Map<string, string[]>();
      for (const f of scan.files) {
        const list = byCategory.get(f.category) ?? [];
        list.push(f.path);
        byCategory.set(f.category, list);
      }
      for (const [cat, files] of byCategory) {
        lines.push(`**${cat}:**`);
        for (const f of files) lines.push(`  - ${f}`);
      }
    }

    if (scan.rootFiles.length > 0) {
      lines.push(`\n**Root files:**`);
      for (const f of scan.rootFiles) lines.push(`  - ${f}`);
    }

    if (scan.crossToolFiles.length > 0) {
      lines.push(`\n**Cross-tool files** (readable by ${scan.toolName}, consider canonical migration):`);
      for (const f of scan.crossToolFiles) lines.push(`  - ${f.path} (${f.category})`);
    }

    lines.push("");
  }

  if (heuristicFiles.length > 0) {
    // Filter out files already reported
    const reported = new Set(
      scanResults.flatMap((s) => [...s.rootFiles, ...s.files.map((f) => f.path)])
    );
    const novel = heuristicFiles.filter((f) => !reported.has(f));
    if (novel.length > 0) {
      lines.push(`## Potential AI instruction files (heuristic)\n`);
      for (const f of novel) lines.push(`  - ${f}`);
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("For each file above, read its content and propose migration to the appropriate .ai/ canonical location.");
  lines.push("Ask the user for confirmation before migrating each file.");

  return textResponse(lines.join("\n"));
}
