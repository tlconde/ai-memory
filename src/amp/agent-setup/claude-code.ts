/**
 * Claude Code project-level projection import setup.
 *
 * Falsifiable claim: dry-run plans CLAUDE.md marker updates; apply writes only
 * inside the AMP marker block and never touches global ~/.claude/CLAUDE.md.
 */

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  hasCompleteMarkerBlock,
  isMalformedMarkerBlock,
  parseMarkerBlock,
  upsertMarkerBlock,
} from "./markers.js";
import {
  PROJECTION_MATERIALIZATION_REQUIRED,
  checkProjectProjectionPreflight,
} from "./preflight.js";
import type { AgentSetupMode, AgentSetupResult } from "./types.js";

export const CLAUDE_PROJECT_FILENAME = "CLAUDE.md";
export { PROJECTION_MATERIALIZATION_REQUIRED };

const CLAUDE_IMPORT_LINES = [
  "@.amp/local/projection.md",
  "@.amp/local/runtime.md",
] as const;

export interface ClaudeCodeSetupOptions {
  projectRoot: string;
  mode: AgentSetupMode;
}

function claudePath(projectRoot: string): string {
  return join(projectRoot, CLAUDE_PROJECT_FILENAME);
}

/** Plan or apply Claude Code project import wiring in CLAUDE.md. */
export async function runClaudeCodeProjectSetup(
  options: ClaudeCodeSetupOptions
): Promise<AgentSetupResult> {
  const { projectRoot, mode } = options;
  const targetPath = claudePath(projectRoot);
  const preflight = checkProjectProjectionPreflight({
    projectRoot,
    mode,
    requireFiles: false,
  });

  if (!preflight.ok) {
    return {
      target: "claude-code",
      mode,
      plannedPaths: [targetPath],
      changed: false,
      ok: false,
      warnings: preflight.warnings,
      errors: preflight.errors,
    };
  }

  const existingContent = existsSync(targetPath)
    ? await readFile(targetPath, "utf8")
    : "";
  const plannedContent = upsertMarkerBlock(existingContent, CLAUDE_IMPORT_LINES);
  const changed = plannedContent !== existingContent;

  if (mode === "dry-run") {
    return {
      target: "claude-code",
      mode,
      plannedPaths: [targetPath],
      changed,
      ok: true,
      warnings: preflight.warnings,
      errors: [],
    };
  }

  await writeFile(targetPath, plannedContent, "utf8");
  return {
    target: "claude-code",
    mode,
    plannedPaths: [targetPath],
    changed,
    ok: true,
    warnings: preflight.warnings,
    errors: [],
  };
}

/** Read-only inspection for doctor checks. */
export function inspectClaudeCodeMarkerBlock(content: string): {
  present: boolean;
  malformed: boolean;
  inner?: string;
} {
  if (isMalformedMarkerBlock(content)) {
    return { present: false, malformed: true };
  }
  if (!hasCompleteMarkerBlock(content)) {
    return { present: false, malformed: false };
  }
  const parsed = parseMarkerBlock(content);
  return { present: true, malformed: false, inner: parsed?.inner };
}
