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

export type SchemaType = (typeof VALID_TYPES)[number];
export type SchemaStatus = (typeof VALID_STATUSES)[number];
