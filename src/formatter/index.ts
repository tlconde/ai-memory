import { readFile, writeFile, readdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import matter from "gray-matter";

export interface ValidationError {
  file: string;
  message: string;
}

const VALID_TYPES = [
  "identity", "direction", "decision", "pattern", "debugging",
  "skill", "toolbox", "rule", "agent", "index",
];
const VALID_STATUSES = ["active", "deprecated", "experimental"];

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

  // Required fields
  if (!fm.id) errors.push(`Missing required field: id`);
  if (!fm.type) errors.push(`Missing required field: type`);
  if (!fm.status) errors.push(`Missing required field: status`);

  // Valid enum values
  if (fm.type && !VALID_TYPES.includes(fm.type as string)) {
    errors.push(`Invalid type "${fm.type}". Must be one of: ${VALID_TYPES.join(", ")}`);
  }
  if (fm.status && !VALID_STATUSES.includes(fm.status as string)) {
    errors.push(`Invalid status "${fm.status}". Must be one of: ${VALID_STATUSES.join(", ")}`);
  }

  return errors;
}

// Auto-add minimal frontmatter if missing
export function ensureFrontmatter(filePath: string, content: string): string {
  // Skip temp/ and non-.md files
  if (filePath.includes("/temp/") || filePath.includes("\\temp\\")) return content;

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(content);
  } catch {
    return content; // can't parse — leave as-is
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
    else if (filePath.endsWith("DIRECTION.md")) fm.type = "direction";
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
    const rel = file.replace(aiDir, "").replace(/^[/\\]/, "");
    for (const msg of fileErrors) {
      errors.push({ file: rel, message: msg });
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
