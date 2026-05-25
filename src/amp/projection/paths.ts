/**
 * Platform-default AMP projection file paths.
 *
 * Falsifiable claim: each projection kind resolves to the canonical AMP-managed
 * path documented in AMP_CONSOLIDATED_SPEC §4.2.1.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import type { ProjectionFileKind } from "./constants.js";

export const AMP_USER_ROOT_DIR = ".amp";
export const GLOBAL_PROJECTION_REL = join("projection", "global.md");
export const GLOBAL_RUNTIME_REL = join("runtime", "global.md");
export const PROJECT_LOCAL_DIR = join(".amp", "local");
export const PROJECT_PROJECTION_FILENAME = "projection.md";
export const PROJECT_RUNTIME_FILENAME = "runtime.md";

export interface PathContext {
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
}

function ctx(options: PathContext = {}) {
  return {
    env: options.env ?? process.env,
    homedir: options.homedir ?? homedir,
  };
}

function ampUserRoot(options: PathContext = {}): string {
  const { env, homedir: home } = ctx(options);
  const override = env.AMP_USER_ROOT?.trim();
  if (override) return override;
  return join(home(), AMP_USER_ROOT_DIR);
}

/** Resolve the canonical filesystem path for a projection kind. */
export function projectionFilePath(
  kind: ProjectionFileKind,
  options: PathContext & { projectRoot?: string } = {}
): string {
  switch (kind) {
    case "global_projection":
      return join(ampUserRoot(options), GLOBAL_PROJECTION_REL);
    case "global_runtime":
      return join(ampUserRoot(options), GLOBAL_RUNTIME_REL);
    case "project_projection":
      if (!options.projectRoot) {
        throw new Error("projectRoot is required for project_projection paths");
      }
      return join(options.projectRoot, PROJECT_LOCAL_DIR, PROJECT_PROJECTION_FILENAME);
    case "project_runtime":
      if (!options.projectRoot) {
        throw new Error("projectRoot is required for project_runtime paths");
      }
      return join(options.projectRoot, PROJECT_LOCAL_DIR, PROJECT_RUNTIME_FILENAME);
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
