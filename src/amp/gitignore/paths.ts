/**
 * Canonical AMP-managed project-local paths for Invariant 6 gitignore protection.
 */

import { join } from "node:path";

import { PROJECT_CONFIG_DIR } from "../config/paths.js";

export const AMP_LOCAL_DIR_REL = join(PROJECT_CONFIG_DIR, "local") + "/";
export const AMP_RUNTIME_DIR_REL = join(PROJECT_CONFIG_DIR, "runtime") + "/";

export const AMP_GITIGNORE_MARKER = "# AMP-managed local artifacts (Invariant 6)";

export const DEFAULT_AMP_GITIGNORE_LINES = [AMP_LOCAL_DIR_REL, AMP_RUNTIME_DIR_REL] as const;

/** Relative directory patterns that AMP init must keep out of version control. */
export function listAmpManagedProjectRelPaths(): readonly string[] {
  return DEFAULT_AMP_GITIGNORE_LINES;
}
