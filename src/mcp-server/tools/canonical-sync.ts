/**
 * Canonical sync: detects drift between tool directories and .ai/ canonical.
 *
 * Four gap types:
 * - uncanonical: tool file exists, no canonical in .ai/
 * - missing-stub: canonical exists in .ai/, no stub in tool dir
 * - non-stub: tool file should be a stub but has full content
 * - orphaned-stub: stub points to .ai/ path that doesn't exist
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { writeFile, mkdir } from "fs/promises";
import { basename, join, relative } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { TOOL_PATH_MAPPINGS } from "./tool-inspect.js";
import { getDetectedToolsWithPaths, scanExistingFiles } from "../../cli/environment.js";
import { AI_PATHS, textResponse, type McpResponse } from "./shared.js";

// ─── Types ───────────────────────────────────────────────────────────────

export interface SyncGap {
  type: "uncanonical" | "missing-stub" | "non-stub" | "orphaned-stub";
  toolId: string;
  toolPath: string;
  canonicalPath?: string;
  details: string;
}

export interface SyncReport {
  timestamp: string;
  gaps: SyncGap[];
  summary: { total: number; uncanonical: number; missingStubs: number; nonStubs: number; orphanedStubs: number };
  toolsScanned: string[];
}

// ─── Stub detection (iCoffee criteria) ───────────────────────────────────

const MAX_STUB_LINES = 12;

export function isStub(content: string): boolean {
  const lines = content.split("\n");
  let i = 0;
  // Skip YAML frontmatter
  if (lines[i]?.trim() === "---") {
    i++;
    while (i < lines.length && lines[i]?.trim() !== "---") i++;
    i++;
  }
  // Count non-empty content lines
  let count = 0;
  while (i < lines.length) {
    if (lines[i]?.trim()) count++;
    i++;
  }
  const hasAiRef = content.includes(".ai/");
  return count <= MAX_STUB_LINES && hasAiRef;
}

// ─── Canonical path mapping ──────────────────────────────────────────────

/** Maps tool subdirectory types to canonical .ai/ locations. */
const CANONICAL_DIRS: Record<string, string> = {
  rules: "rules",
  skills: "skills",
  commands: "commands",
  agents: "agents",
};

/** Extract the base name from a tool file path, stripping tool prefix and extension. */
function extractName(toolPath: string): string {
  const parts = toolPath.replace(/\\/g, "/").split("/");
  // For skills: .cursor/skills/foo/SKILL.md → foo
  if (parts.includes("skills") && parts[parts.length - 1] === "SKILL.md") {
    return parts[parts.length - 2];
  }
  // For rules/commands: .cursor/rules/foo.mdc → foo
  const file = parts[parts.length - 1];
  return file.replace(/\.(mdc|md)$/, "");
}

/** Infer the category from a tool-relative path. */
function inferCategory(toolPath: string): string | null {
  const normalized = toolPath.replace(/\\/g, "/");
  for (const cat of Object.keys(CANONICAL_DIRS)) {
    if (normalized.includes(`/${cat}/`) || normalized.includes(`\\${cat}\\`)) return cat;
  }
  return null;
}

/** Get expected canonical path for a tool file. Returns null if unmappable. */
function toCanonicalPath(toolPath: string): string | null {
  const category = inferCategory(toolPath);
  if (!category) return null;
  const name = extractName(toolPath);
  if (!name || name === "00-load-ai-memory") return null;
  const canonDir = CANONICAL_DIRS[category];
  if (category === "skills") return `.ai/${canonDir}/${name}/SKILL.md`;
  if (category === "commands") return `.ai/${canonDir}/${name}/COMMAND.md`;
  return `.ai/${canonDir}/${name}.md`;
}

/** Get expected tool stub path for a canonical file. */
function toToolStubPath(canonicalPath: string, toolId: string): string | null {
  const mapping = TOOL_PATH_MAPPINGS[toolId];
  if (!mapping) return null;

  const normalized = canonicalPath.replace(/\\/g, "/");
  const parts = normalized.replace(".ai/", "").split("/");
  const category = parts[0]; // rules, skills, commands, agents

  if (category === "skills" && mapping.skillsDir) {
    const name = parts[1]; // skills/<name>/SKILL.md
    return `${mapping.skillsDir}/${name}/SKILL.md`;
  }
  if (category === "rules" && mapping.rulesDir) {
    const name = parts[1].replace(/\.md$/, "");
    // Cursor uses .mdc, others use .md
    const ext = toolId === "cursor" ? ".mdc" : ".md";
    return `${mapping.rulesDir}/${name}${ext}`;
  }
  // commands dir — not all tools have this
  return null;
}

// ─── ai-memory managed files to skip ─────────────────────────────────────

const AI_MEMORY_SKILL_NAMES = new Set([
  "mem-compound", "mem-session-close", "mem-validate", "mem-init",
  "browser", "screen-capture", "desktop-automation", "mem-auto-review",
]);

const AI_MEMORY_MANAGED_PREFIXES = [
  "00-load-ai-memory",
];

function isManagedFile(toolPath: string): boolean {
  const normalized = toolPath.replace(/\\/g, "/");
  const file = basename(normalized);

  // Managed bootstrap/config files
  if (AI_MEMORY_MANAGED_PREFIXES.some((p) => file.startsWith(p))) return true;

  // Managed skill stubs
  const skillMatch = normalized.match(/\.(cursor|claude|agents)\/skills\/([^/]+)\/SKILL\.md$/);
  if (skillMatch && AI_MEMORY_SKILL_NAMES.has(skillMatch[2])) return true;

  // Config files
  if (/\b(mcp|settings|config)\.(json|local\.json)$/.test(file)) return true;

  // Hook scripts
  if (normalized.includes("/hooks/")) return true;

  return false;
}

// ─── Core scan ───────────────────────────────────────────────────────────

/**
 * Scan for canonical sync gaps between tool directories and .ai/.
 */
export function canonicalSyncCheck(projectRoot: string, aiDir: string): SyncReport {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const detectedTools = getDetectedToolsWithPaths(projectRoot, packageRoot);
  const gaps: SyncGap[] = [];
  const toolsScanned: string[] = [];

  for (const tool of detectedTools) {
    const mapping = TOOL_PATH_MAPPINGS[tool.id];
    if (!mapping) continue;
    toolsScanned.push(tool.id);

    // Collect all tool files in rules/skills dirs
    const toolFiles = collectToolFiles(projectRoot, tool.id, mapping);

    for (const toolPath of toolFiles) {
      if (isManagedFile(toolPath)) continue;

      const canonicalPath = toCanonicalPath(toolPath);
      if (!canonicalPath) continue;

      const absCanonical = join(projectRoot, canonicalPath);
      const absToolFile = join(projectRoot, toolPath);

      let content: string;
      try {
        content = readFileSync(absToolFile, "utf-8");
      } catch {
        continue;
      }

      if (existsSync(absCanonical)) {
        // Canonical exists — check if tool file is a proper stub
        if (!isStub(content)) {
          gaps.push({
            type: "non-stub",
            toolId: tool.id,
            toolPath,
            canonicalPath,
            details: `Full content (not a stub). Move content to ${canonicalPath}, replace with stub.`,
          });
        }
      } else {
        // No canonical — check if it's a stub pointing to a nonexistent file (orphan)
        if (isStub(content)) {
          gaps.push({
            type: "orphaned-stub",
            toolId: tool.id,
            toolPath,
            canonicalPath,
            details: `Stub points to ${canonicalPath} which does not exist. Delete stub or create canonical.`,
          });
        } else {
          // Full content with no canonical — uncanonical
          gaps.push({
            type: "uncanonical",
            toolId: tool.id,
            toolPath,
            canonicalPath,
            details: `No canonical at ${canonicalPath}. Create canonical and replace with stub.`,
          });
        }
      }
    }

    // Check 2: Missing stubs — canonical files without tool stubs
    const canonicalDirs = ["rules", "skills", "commands", "agents"];
    for (const cat of canonicalDirs) {
      const absCanonDir = join(aiDir, cat);
      if (!existsSync(absCanonDir)) continue;

      const canonicalFiles = listCanonicalFiles(absCanonDir, aiDir, cat);
      for (const canonicalPath of canonicalFiles) {
        const expectedStub = toToolStubPath(canonicalPath, tool.id);
        if (!expectedStub) continue;

        const absStub = join(projectRoot, expectedStub);
        if (!existsSync(absStub)) {
          gaps.push({
            type: "missing-stub",
            toolId: tool.id,
            toolPath: expectedStub,
            canonicalPath,
            details: `Canonical ${canonicalPath} exists but no stub at ${expectedStub}.`,
          });
        }
      }
    }
  }

  const summary = {
    total: gaps.length,
    uncanonical: gaps.filter((g) => g.type === "uncanonical").length,
    missingStubs: gaps.filter((g) => g.type === "missing-stub").length,
    nonStubs: gaps.filter((g) => g.type === "non-stub").length,
    orphanedStubs: gaps.filter((g) => g.type === "orphaned-stub").length,
  };

  return { timestamp: new Date().toISOString(), gaps, summary, toolsScanned };
}

/** Collect files from tool rules/skills directories. */
function collectToolFiles(
  projectRoot: string,
  toolId: string,
  mapping: { rulesDir: string | null; skillsDir: string | null }
): string[] {
  const files: string[] = [];
  for (const dir of [mapping.rulesDir, mapping.skillsDir]) {
    if (!dir) continue;
    const absDir = join(projectRoot, dir);
    if (!existsSync(absDir)) continue;
    files.push(...listRecursive(absDir, projectRoot));
  }
  return files;
}

function listRecursive(dir: string, projectRoot: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...listRecursive(full, projectRoot));
    else if (entry.isFile()) results.push(relative(projectRoot, full).replace(/\\/g, "/"));
  }
  return results;
}

/** List canonical files in .ai/rules/, .ai/skills/, etc. */
function listCanonicalFiles(absDir: string, aiDir: string, category: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (category === "skills" || category === "commands") {
        // Skills/commands are directories: .ai/skills/<name>/SKILL.md
        if (entry.isDirectory()) {
          const suffix = category === "skills" ? "SKILL.md" : "COMMAND.md";
          const target = join(absDir, entry.name, suffix);
          if (existsSync(target)) {
            results.push(`.ai/${category}/${entry.name}/${suffix}`);
          }
        }
      } else {
        // Rules/agents are flat files: .ai/rules/<name>.md
        if (entry.isFile() && entry.name.endsWith(".md")) {
          results.push(`.ai/${category}/${entry.name}`);
        }
      }
    }
  } catch { /* directory unreadable */ }
  return results;
}

// ─── Output writers ──────────────────────────────────────────────────────

/** Write sync status as markdown and JSON to .ai/temp/. */
export async function writeSyncStatus(aiDir: string, report: SyncReport): Promise<string> {
  const tempDir = join(aiDir, "temp");
  await mkdir(tempDir, { recursive: true });

  // JSON
  await writeFile(join(aiDir, AI_PATHS.SYNC_REPORT), JSON.stringify(report, null, 2));

  // Markdown
  const md = formatSyncReport(report);
  await writeFile(join(aiDir, AI_PATHS.SYNC_STATUS), md);

  return md;
}

function formatSyncReport(report: SyncReport): string {
  const { summary, gaps, toolsScanned } = report;
  const lines: string[] = [`# Canonical Sync Status`, `Generated: ${report.timestamp}`, ""];

  if (summary.total === 0) {
    lines.push(`All ${toolsScanned.length} tool(s) in sync with .ai/ canonical.`);
    return lines.join("\n");
  }

  lines.push(`## ${summary.total} gap(s) found\n`);

  const grouped: Record<string, SyncGap[]> = {
    uncanonical: gaps.filter((g) => g.type === "uncanonical"),
    "missing-stub": gaps.filter((g) => g.type === "missing-stub"),
    "non-stub": gaps.filter((g) => g.type === "non-stub"),
    "orphaned-stub": gaps.filter((g) => g.type === "orphaned-stub"),
  };

  const labels: Record<string, string> = {
    uncanonical: "Uncanonical (tool file, no canonical)",
    "missing-stub": "Missing Stubs (canonical exists, no tool stub)",
    "non-stub": "Non-Stub Content (full content where stub expected)",
    "orphaned-stub": "Orphaned Stubs (stub points to nonexistent canonical)",
  };

  for (const [type, items] of Object.entries(grouped)) {
    if (items.length === 0) continue;
    lines.push(`### ${labels[type]} (${items.length})`);
    for (const g of items) {
      lines.push(`- \`${g.toolPath}\` — ${g.details}`);
    }
    lines.push("");
  }

  lines.push("---", "Run `canonical_sync` (MCP) or `ai-memory sync-check` (CLI) to refresh.");
  return lines.join("\n");
}

// ─── Open item creation ──────────────────────────────────────────────────

export async function appendSyncOpenItems(aiDir: string, gaps: SyncGap[]): Promise<number> {
  if (gaps.length === 0) return 0;
  const openItemsPath = join(aiDir, AI_PATHS.OPEN_ITEMS);
  let existing = "";
  try { existing = readFileSync(openItemsPath, "utf-8"); } catch { /* file may not exist */ }

  const date = new Date().toISOString().split("T")[0];
  const newItems = gaps
    .filter((g) => !existing.includes(g.toolPath)) // Avoid duplicates
    .map((g) => `- [ ] [sync] \`${g.toolPath}\` — ${g.details} (flagged ${date})`);

  if (newItems.length === 0) return 0;

  const insertion = newItems.join("\n") + "\n";
  // Insert after "## Open" line if it exists
  const openIdx = existing.indexOf("## Open");
  if (openIdx !== -1) {
    const afterOpen = existing.indexOf("\n", openIdx);
    const before = existing.slice(0, afterOpen + 1);
    const after = existing.slice(afterOpen + 1);
    await writeFile(openItemsPath, before + insertion + after);
  } else {
    await writeFile(openItemsPath, existing + "\n" + insertion);
  }

  return newItems.length;
}

// ─── MCP tool handler ────────────────────────────────────────────────────

export async function handleCanonicalSync(
  projectRoot: string,
  aiDir: string,
  args: Record<string, unknown>
): Promise<McpResponse> {
  const report = canonicalSyncCheck(projectRoot, aiDir);
  const md = await writeSyncStatus(aiDir, report);

  if (args.fix && report.gaps.length > 0) {
    const count = await appendSyncOpenItems(aiDir, report.gaps);
    if (count > 0) {
      return textResponse(md + `\n\n✓ Added ${count} open item(s) to sessions/open-items.md`);
    }
  }

  return textResponse(md);
}
