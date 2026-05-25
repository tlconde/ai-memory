/**
 * Shared projection readiness checks for agent setup targets.
 *
 * Claude, Cursor, and Codex use different strictness because Claude writes import paths
 * that can resolve after materialization, while Cursor/Codex flattening must read file
 * contents during apply.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  PROJECT_LOCAL_DIR,
  projectProjectionPath,
  projectRuntimePath,
} from "../projection/paths.js";
import type { AgentSetupMode } from "./types.js";

export const PROJECTION_FILES_MISSING_WARNING =
  "Project projection files are missing; imports will reference paths that may not exist yet.";

export const PROJECTION_MATERIALIZATION_REQUIRED =
  "Run `ai-memory amp projection render --source local --apply` first to materialize project projection files.";

export interface ProjectProjectionPreflightOptions {
  projectRoot: string;
  mode: AgentSetupMode;
  /** When true, apply fails unless both projection files exist (Cursor). */
  requireFiles: boolean;
}

export interface ProjectProjectionPreflightResult {
  ok: boolean;
  warnings: string[];
  errors: string[];
  localDirExists: boolean;
  projectionExists: boolean;
  runtimeExists: boolean;
}

/** Check whether project-local projection artifacts are ready for agent setup. */
export function checkProjectProjectionPreflight(
  options: ProjectProjectionPreflightOptions
): ProjectProjectionPreflightResult {
  const { projectRoot, mode, requireFiles } = options;
  const warnings: string[] = [];
  const errors: string[] = [];
  const localDirExists = existsSync(join(projectRoot, PROJECT_LOCAL_DIR));
  const projectionExists = existsSync(projectProjectionPath(projectRoot));
  const runtimeExists = existsSync(projectRuntimePath(projectRoot));
  const filesExist = projectionExists && runtimeExists;

  if (!filesExist) {
    if (requireFiles) {
      if (mode === "apply") {
        errors.push(PROJECTION_MATERIALIZATION_REQUIRED);
      } else {
        warnings.push(PROJECTION_MATERIALIZATION_REQUIRED);
      }
    } else {
      warnings.push(PROJECTION_FILES_MISSING_WARNING);
    }
  }

  if (!requireFiles && mode === "apply" && !localDirExists) {
    errors.push(PROJECTION_MATERIALIZATION_REQUIRED);
  }

  return {
    ok: errors.length === 0,
    warnings,
    errors,
    localDirExists,
    projectionExists,
    runtimeExists,
  };
}
