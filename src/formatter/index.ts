import { readFile, writeFile, readdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import matter from "gray-matter";
import { SKILL_TOOL_NAMES_BLOCKLIST, validateRequiredFrontmatter } from "../schema-constants.js";

export interface ValidationError {
  file: string;
  message: string;
  /** "error" fails validate; "warn" logs but does not fail */
  severity?: "error" | "warn";
}

// Validate frontmatter of a single file
export function validateFrontmatter(
  filePath: string,
  content: string
): string[] {
  const errors: string[] = [];

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    return [`Invalid YAML frontmatter`];
  }

  const fm = parsed.data;

  // Files in temp/ are auto-generated — skip validation
  if (filePath.includes("/temp/") || filePath.includes("\\temp\\")) {
    return [];
  }

  errors.push(...validateRequiredFrontmatter(fm));
  return errors;
}

/** Warn if skill content contains tool names — skills should declare capabilities, not tools. */
export function validateSkillContent(filePath: string, content: string): string[] {
  const warnings: string[] = [];
  if (!filePath.includes("/skills/") || !filePath.endsWith("SKILL.md")) return warnings;

  const body = content.replace(/^---[\s\S]*?---\s*/m, "").toLowerCase();
  for (const tool of SKILL_TOOL_NAMES_BLOCKLIST) {
    if (body.includes(tool)) {
      warnings.push(`Skill references tool "${tool}" — prefer capability-based requires (see [P1] Capability-based skills)`);
    }
  }
  return warnings;
}

// Auto-add minimal frontmatter if missing
export function ensureFrontmatter(filePath: string, content: string): string {
  // Skip temp/ and non-.md files
  if (filePath.includes("/temp/") || filePath.includes("\\temp\\")) return content;

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    return content;
  }

  const fm = parsed.data;
  let changed = false;

  if (!fm.id) {
    // Derive id from filename
    const basename = filePath.split(/[\\/]/).pop()?.replace(".md", "") ?? "unknown";
    fm.id = basename.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    changed = true;
  }

  if (!fm.type) {
    // Infer type from path
    if (filePath.includes("/memory/")) fm.type = "decision";
    else if (filePath.includes("/agents/")) fm.type = "agent";
    else if (filePath.includes("/skills/")) fm.type = "skill";
    else if (filePath.includes("/toolbox/")) fm.type = "toolbox";
    else if (filePath.includes("/rules/")) fm.type = "rule";
    else if (filePath.endsWith("IDENTITY.md")) fm.type = "identity";
    else if (filePath.endsWith("PROJECT_STATUS.md")) fm.type = "project-status";
    else fm.type = "decision";
    changed = true;
  }

  if (!fm.status) {
    fm.status = "active";
    changed = true;
  }

  if (!changed) return content;

  // Reconstruct file with updated frontmatter
  const newFm = Object.keys(fm)
    .map((k) => `${k}: ${JSON.stringify(fm[k])}`)
    .join("\n");
  return `---\n${newFm}\n---\n\n${parsed.content.trimStart()}`;
}

// Validate all .md files under aiDir
export async function validateAll(aiDir: string): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];
  const files = await collectMdFiles(aiDir);

  for (const file of files) {
    const content = await readFile(file, "utf-8");
    const fileErrors = validateFrontmatter(file, content);
    const skillWarnings = validateSkillContent(file, content);
    const rel = file.replace(aiDir, "").replace(/^[/\\]/, "");
    for (const msg of fileErrors) {
      errors.push({ file: rel, message: msg, severity: "error" });
    }
    for (const msg of skillWarnings) {
      errors.push({ file: rel, message: msg, severity: "warn" });
    }
  }

  return errors;
}

// Format (auto-fix frontmatter) on all .md files under aiDir
export async function formatAll(aiDir: string): Promise<number> {
  const files = await collectMdFiles(aiDir);
  let count = 0;

  for (const file of files) {
    const original = await readFile(file, "utf-8");
    const formatted = ensureFrontmatter(file, original);
    if (formatted !== original) {
      await writeFile(file, formatted);
      count++;
    }
  }

  return count;
}

async function collectMdFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectMdFiles(full)));
    } else if (entry.name.endsWith(".md")) {
      results.push(full);
    }
  }

  return results;
}

/** Extract [P0]/[P1]/[P2] entry titles from markdown (skip [DEPRECATED]). */
function extractEntries(content: string): Array<{ priority: string; title: string }> {
  const entries: Array<{ priority: string; title: string }> = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const m = line.match(/^###\s*\[(P[012])\]\s*(.+?)(?:\s*\[DEPRECATED\])?$/);
    if (m) {
      const title = m[2].replace(/\s*\[DEPRECATED\]\s*$/, "").trim();
      if (!line.includes("[DEPRECATED]")) entries.push({ priority: m[1], title });
    }
  }
  return entries;
}

/** Regenerate memory-index.md from decisions, patterns, debugging, improvements. */
export async function generateMemoryIndex(aiDir: string): Promise<void> {
  const memoryDir = join(aiDir, "memory");
  if (!existsSync(memoryDir)) return;

  const sections: Array<{ file: string; entries: Array<{ priority: string; title: string }> }> = [];
  for (const file of ["decisions.md", "patterns.md", "debugging.md", "improvements.md"]) {
    const path = join(memoryDir, file);
    if (!existsSync(path)) continue;
    const content = await readFile(path, "utf-8");
    const entries = extractEntries(content);
    if (entries.length > 0) sections.push({ file, entries });
  }

  const priorityOrder = ["P0", "P1", "P2"];
  const lines: string[] = [
    "---",
    `id: memory-index`,
    "type: index",
    "status: active",
    `last_updated: ${new Date().toISOString().slice(0, 10)}`,
    "---",
    "",
    "# Memory Index",
    "",
    "**Auto-generated.** Run `ai-memory index` or `/mem-compound` to regenerate.",
    "",
    "---",
    "",
  ];

  for (const { file, entries } of sections) {
    const label = file.replace(".md", "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    lines.push(`## ${label}\n`);
    const sorted = [...entries].sort((a, b) => priorityOrder.indexOf(a.priority) - priorityOrder.indexOf(b.priority));
    for (const e of sorted) {
      lines.push(`- **[${e.priority}]** ${e.title}`);
    }
    lines.push("");
  }

  const indexPath = join(memoryDir, "memory-index.md");
  await writeFile(indexPath, lines.join("\n").trimEnd() + "\n");
}
