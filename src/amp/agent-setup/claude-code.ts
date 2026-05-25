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
  PROJECT_LOCAL_DIR,
  PROJECT_PROJECTION_FILENAME,
  PROJECT_RUNTIME_FILENAME,
} from "../projection/paths.js";
import {
  hasCompleteMarkerBlock,
  isMalformedMarkerBlock,
  parseMarkerBlock,
  upsertMarkerBlock,
  type AgentSetupMode,
  type AgentSetupResult,
} from "./index.js";

export const CLAUDE_PROJECT_FILENAME = "CLAUDE.md";

const CLAUDE_IMPORT_LINES = [
  "@.amp/local/projection.md",
  "@.amp/local/runtime.md",
] as const;

export const PROJECTION_MATERIALIZATION_REQUIRED =
  "Run `ai-memory amp projection render --source local --apply` first to materialize project projection files.";

export interface ClaudeCodeSetupOptions {
  projectRoot: string;
  mode: AgentSetupMode;
}

function projectLocalDir(projectRoot: string): string {
  return join(projectRoot, PROJECT_LOCAL_DIR);
}

function projectionPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_LOCAL_DIR, PROJECT_PROJECTION_FILENAME);
}

function runtimePath(projectRoot: string): string {
  return join(projectRoot, PROJECT_LOCAL_DIR, PROJECT_RUNTIME_FILENAME);
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
  const warnings: string[] = [];
  const errors: string[] = [];
  const localDir = projectLocalDir(projectRoot);
  const projectionExists = existsSync(projectionPath(projectRoot));
  const runtimeExists = existsSync(runtimePath(projectRoot));

  if (!projectionExists || !runtimeExists) {
    warnings.push(
      "Project projection files are missing; imports will reference paths that may not exist yet."
    );
  }

  if (mode === "apply" && !existsSync(localDir)) {
    return {
      target: "claude-code",
      mode,
      plannedPaths: [targetPath],
      changed: false,
      ok: false,
      warnings,
      errors: [PROJECTION_MATERIALIZATION_REQUIRED],
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
      warnings,
      errors,
    };
  }

  await writeFile(targetPath, plannedContent, "utf8");
  return {
    target: "claude-code",
    mode,
    plannedPaths: [targetPath],
    changed,
    ok: true,
    warnings,
    errors,
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
