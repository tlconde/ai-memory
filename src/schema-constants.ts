// Canonical schema constants — single source of truth for valid types and statuses.
// Used by both the formatter and MCP tools.

export const VALID_TYPES = [
  "identity",
  "project-status",
  "decision",
  "pattern",
  "debugging",
  "improvement",
  "index",
  "session",
  "reference",
  "agent",
  "skill",
  "rule",
  "acp",
  "toolbox",
  "docs-schema",
] as const;

export const VALID_STATUSES = ["active", "deprecated", "superseded", "draft", "experimental"] as const;

/** Tool names to flag in skill content — skills should declare capabilities, not tools. */
export const SKILL_TOOL_NAMES_BLOCKLIST = [
  "cursor",
  "claude-code",
  "claude code",
  "windsurf",
  "cline",
  "zed",
  "codex",
  "copilot",
  "antigravity",
] as const;

export const VALID_OUTCOMES = ["success", "failure", "partial"] as const;

export type SchemaType = (typeof VALID_TYPES)[number];
export type SchemaStatus = (typeof VALID_STATUSES)[number];
export type Outcome = (typeof VALID_OUTCOMES)[number];

/** Validate required frontmatter fields (id, type, status) and enum values. */
export function validateRequiredFrontmatter(fm: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!fm.id) errors.push("Missing required field: id");
  if (!fm.type) errors.push("Missing required field: type");
  if (!fm.status) errors.push("Missing required field: status");
  if (fm.type && !(VALID_TYPES as readonly string[]).includes(fm.type as string)) {
    errors.push(`Invalid type "${fm.type}". Must be one of: ${VALID_TYPES.join(", ")}`);
  }
  if (fm.status && !(VALID_STATUSES as readonly string[]).includes(fm.status as string)) {
    errors.push(`Invalid status "${fm.status}". Must be one of: ${VALID_STATUSES.join(", ")}`);
  }
  return errors;
}
