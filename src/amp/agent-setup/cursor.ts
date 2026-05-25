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
import { formatCursorMdcFrontmatter } from "../procedural/compile-cursor.js";
import { projectProjectionPath, projectRuntimePath } from "../projection/paths.js";
import { checkProjectProjectionPreflight } from "./preflight.js";
import type { AgentSetupMode, AgentSetupResult } from "./types.js";

export const CURSOR_PROJECTION_RULE_FILENAME = "amp-projection.mdc";
export const CURSOR_PROJECTION_RULE_DESCRIPTION =
  "AMP project projection and runtime context";

export { PROJECTION_MATERIALIZATION_REQUIRED as CURSOR_PROJECTION_FILES_MISSING } from "./preflight.js";

export interface CursorSetupOptions {
  projectRoot: string;
  mode: AgentSetupMode;
}

function cursorRulePath(projectRoot: string): string {
  return join(projectRoot, CURSOR_FROM_AMP_REL, CURSOR_PROJECTION_RULE_FILENAME);
}

export function buildCursorProjectionMdc(
  projectionBody: string,
  runtimeBody: string
): string {
  const frontmatter = formatCursorMdcFrontmatter({
    description: CURSOR_PROJECTION_RULE_DESCRIPTION,
    globs: [],
    alwaysApply: true,
  });

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
  const preflight = checkProjectProjectionPreflight({
    projectRoot,
    mode,
    requireFiles: true,
  });

  if (!preflight.ok) {
    return {
      target: "cursor",
      mode,
      plannedPaths: [targetPath],
      changed: false,
      ok: false,
      warnings: preflight.warnings,
      errors: preflight.errors,
    };
  }

  if (!preflight.projectionExists || !preflight.runtimeExists) {
    return {
      target: "cursor",
      mode,
      plannedPaths: [targetPath],
      changed: !existsSync(targetPath),
      ok: true,
      warnings: preflight.warnings,
      errors: [],
    };
  }

  const projectionBody = await readFile(projectProjectionPath(projectRoot), "utf8");
  const runtimeBody = await readFile(projectRuntimePath(projectRoot), "utf8");
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
      warnings: preflight.warnings,
      errors: [],
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
    warnings: preflight.warnings,
    errors: [],
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
