/**
 * Codex project-level AGENTS.md setup with inlined projection/runtime content.
 *
 * Falsifiable claim: dry-run plans AGENTS.md marker updates; apply writes only
 * inside the AMP marker block with flattened `.amp/local` bodies — no `@` imports.
 */

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  CODEX_MARKER,
  hasCompleteMarkerBlockFor,
  isMalformedMarkerBlockFor,
  parseMarkerBlockFor,
  upsertMarkerBlockFor,
} from "./markers.js";
import {
  PROJECTION_MATERIALIZATION_REQUIRED,
  checkProjectProjectionPreflight,
} from "./preflight.js";
import type { AgentSetupMode, AgentSetupResult } from "./types.js";
import { projectProjectionPath, projectRuntimePath } from "../projection/paths.js";

export const CODEX_PROJECT_FILENAME = "AGENTS.md";
export { PROJECTION_MATERIALIZATION_REQUIRED };

export interface CodexSetupOptions {
  projectRoot: string;
  mode: AgentSetupMode;
}

function codexAgentsPath(projectRoot: string): string {
  return join(projectRoot, CODEX_PROJECT_FILENAME);
}

/** Build flattened projection/runtime markdown for the Codex marker block. */
export function buildCodexMarkerInner(projectionBody: string, runtimeBody: string): string {
  return [
    "## AMP Project Projection",
    "",
    projectionBody.trim(),
    "",
    "## AMP Project Runtime",
    "",
    runtimeBody.trim(),
    "",
  ].join("\n");
}

function innerLinesFromBodies(projectionBody: string, runtimeBody: string): string[] {
  return buildCodexMarkerInner(projectionBody, runtimeBody).split("\n");
}

/** Plan or apply Codex AGENTS.md wiring with inlined projection content. */
export async function runCodexProjectSetup(
  options: CodexSetupOptions
): Promise<AgentSetupResult> {
  const { projectRoot, mode } = options;
  const targetPath = codexAgentsPath(projectRoot);
  const preflight = checkProjectProjectionPreflight({
    projectRoot,
    mode,
    requireFiles: true,
  });

  if (!preflight.ok) {
    return {
      target: "codex",
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
      target: "codex",
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
  const innerLines = innerLinesFromBodies(projectionBody, runtimeBody);
  const existingContent = existsSync(targetPath)
    ? await readFile(targetPath, "utf8")
    : "";
  const plannedContent = upsertMarkerBlockFor(existingContent, innerLines, CODEX_MARKER);
  const changed = plannedContent !== existingContent;

  if (mode === "dry-run") {
    return {
      target: "codex",
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
    target: "codex",
    mode,
    plannedPaths: [targetPath],
    changed,
    ok: true,
    warnings: preflight.warnings,
    errors: [],
  };
}

/** Read-only inspection for doctor checks. */
export function inspectCodexMarkerBlock(content: string): {
  present: boolean;
  malformed: boolean;
  inner?: string;
} {
  if (isMalformedMarkerBlockFor(content, CODEX_MARKER)) {
    return { present: false, malformed: true };
  }
  if (!hasCompleteMarkerBlockFor(content, CODEX_MARKER)) {
    return { present: false, malformed: false };
  }
  const parsed = parseMarkerBlockFor(content, CODEX_MARKER);
  return { present: true, malformed: false, inner: parsed?.inner };
}
