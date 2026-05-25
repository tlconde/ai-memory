/**
 * Verify AMP-managed project-local paths are git-ignored and not trackable.
 */

import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

import { listAmpManagedProjectRelPaths } from "./paths.js";

export interface CheckAmpGitignoreOptions {
  spawnFn?: typeof spawnSync;
}

export interface CheckAmpGitignoreResult {
  projectRoot: string;
  insideGitWorkTree: boolean;
  gitignorePath: string;
  ignoredPaths: string[];
  unprotectedPaths: string[];
  trackablePaths: string[];
  protected: boolean;
}

function runGit(
  projectRoot: string,
  args: string[],
  spawnFn: typeof spawnSync
): { ok: boolean; stdout: string } {
  const result = spawnFn("git", ["-C", projectRoot, ...args], {
    encoding: "utf8",
  });
  return {
    ok: result.status === 0,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
  };
}

function isInsideGitWorkTree(
  projectRoot: string,
  spawnFn: typeof spawnSync
): boolean {
  const { ok, stdout } = runGit(projectRoot, ["rev-parse", "--is-inside-work-tree"], spawnFn);
  return ok && stdout.trim() === "true";
}

function isPathIgnored(
  projectRoot: string,
  relPath: string,
  spawnFn: typeof spawnSync
): boolean {
  const result = spawnFn("git", ["-C", projectRoot, "check-ignore", "-q", "--", relPath], {
    encoding: "utf8",
  });
  return result.status === 0;
}

function listTrackableUnderPrefix(
  projectRoot: string,
  prefix: string,
  spawnFn: typeof spawnSync
): string[] {
  const { ok, stdout } = runGit(projectRoot, ["ls-files", "--", prefix], spawnFn);
  if (!ok) {
    return [];
  }
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Check whether AMP-managed project-local paths are git-ignored and not tracked. */
export function checkAmpGitignoreProtection(
  projectRoot: string,
  options: CheckAmpGitignoreOptions = {}
): CheckAmpGitignoreResult {
  const resolvedRoot = resolve(projectRoot);
  const gitignorePath = join(resolvedRoot, ".gitignore");
  const spawnFn = options.spawnFn ?? spawnSync;
  const managedPaths = listAmpManagedProjectRelPaths();

  if (!isInsideGitWorkTree(resolvedRoot, spawnFn)) {
    return {
      projectRoot: resolvedRoot,
      insideGitWorkTree: false,
      gitignorePath,
      ignoredPaths: [],
      unprotectedPaths: [],
      trackablePaths: [],
      protected: true,
    };
  }

  const ignoredPaths: string[] = [];
  const unprotectedPaths: string[] = [];
  const trackablePaths: string[] = [];

  for (const relPath of managedPaths) {
    if (isPathIgnored(resolvedRoot, relPath, spawnFn)) {
      ignoredPaths.push(relPath);
    } else {
      unprotectedPaths.push(relPath);
    }
    trackablePaths.push(...listTrackableUnderPrefix(resolvedRoot, relPath, spawnFn));
  }

  const uniqueTrackablePaths = [...new Set(trackablePaths)];

  return {
    projectRoot: resolvedRoot,
    insideGitWorkTree: true,
    gitignorePath,
    ignoredPaths,
    unprotectedPaths,
    trackablePaths: uniqueTrackablePaths,
    protected: unprotectedPaths.length === 0 && uniqueTrackablePaths.length === 0,
  };
}
