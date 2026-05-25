/**
 * Cursor flattened projection rule setup.
 *
 * Falsifiable claim: apply writes one flattened `.mdc` under from-amp with
 * projection/runtime content inlined — no recursive @ imports.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { CursorAdapter, CURSOR_FROM_AMP_REL } from "../adapters/sas/cursor/adapter.js";
import { PathSafetyError } from "../path-safety/guard.js";
import {
  PROJECT_LOCAL_DIR,
  PROJECT_PROJECTION_FILENAME,
  PROJECT_RUNTIME_FILENAME,
} from "../projection/paths.js";
import type { AgentSetupMode, AgentSetupResult } from "./types.js";

export const CURSOR_PROJECTION_RULE_FILENAME = "amp-projection.mdc";
export const CURSOR_PROJECTION_RULE_DESCRIPTION =
  "AMP project projection and runtime context";

export const CURSOR_PROJECTION_FILES_MISSING =
  "Project projection files are missing. Run `ai-memory amp projection render --source local --apply` first.";

export interface CursorSetupOptions {
  projectRoot: string;
  mode: AgentSetupMode;
}

function projectionPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_LOCAL_DIR, PROJECT_PROJECTION_FILENAME);
}

function runtimePath(projectRoot: string): string {
  return join(projectRoot, PROJECT_LOCAL_DIR, PROJECT_RUNTIME_FILENAME);
}

function cursorRulePath(projectRoot: string): string {
  return join(projectRoot, CURSOR_FROM_AMP_REL, CURSOR_PROJECTION_RULE_FILENAME);
}

export function buildCursorProjectionMdc(
  projectionBody: string,
  runtimeBody: string
): string {
  const frontmatter = [
    "---",
    `description: ${JSON.stringify(CURSOR_PROJECTION_RULE_DESCRIPTION)}`,
    "globs: []",
    "alwaysApply: true",
    "---",
  ].join("\n");

  const body = [
    "## AMP Project Projection",
    "",
    projectionBody.trim(),
    "",
    "## AMP Project Runtime",
    "",
    runtimeBody.trim(),
    "",
  ].join("\n");

  return `${frontmatter}\n${body}`;
}

/** Plan or apply Cursor flattened projection rule under from-amp. */
export async function runCursorProjectSetup(
  options: CursorSetupOptions
): Promise<AgentSetupResult> {
  const { projectRoot, mode } = options;
  const targetPath = cursorRulePath(projectRoot);
  const projectionFile = projectionPath(projectRoot);
  const runtimeFile = runtimePath(projectRoot);
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!existsSync(projectionFile) || !existsSync(runtimeFile)) {
    if (mode === "apply") {
      return {
        target: "cursor",
        mode,
        plannedPaths: [targetPath],
        changed: false,
        ok: false,
        warnings,
        errors: [CURSOR_PROJECTION_FILES_MISSING],
      };
    }
    warnings.push(CURSOR_PROJECTION_FILES_MISSING);
    return {
      target: "cursor",
      mode,
      plannedPaths: [targetPath],
      changed: !existsSync(targetPath),
      ok: true,
      warnings,
      errors,
    };
  }

  const projectionBody = await readFile(projectionFile, "utf8");
  const runtimeBody = await readFile(runtimeFile, "utf8");
  const content = buildCursorProjectionMdc(projectionBody, runtimeBody);
  const existingContent = existsSync(targetPath)
    ? await readFile(targetPath, "utf8")
    : "";
  const changed = content !== existingContent;

  if (mode === "dry-run") {
    return {
      target: "cursor",
      mode,
      plannedPaths: [targetPath],
      changed,
      ok: true,
      warnings,
      errors,
    };
  }

  const adapter = new CursorAdapter({ projectRoot });
  await adapter.writeEmittedRule(CURSOR_PROJECTION_RULE_FILENAME, content);

  return {
    target: "cursor",
    mode,
    plannedPaths: [targetPath],
    changed,
    ok: true,
    warnings,
    errors,
  };
}

/** Resolve a write path through Cursor from-amp guards (for tests). */
export function resolveCursorSetupWritePath(
  projectRoot: string,
  relativePath: string
): string {
  const adapter = new CursorAdapter({ projectRoot });
  return adapter.resolveWritePath(relativePath);
}

export { PathSafetyError };
