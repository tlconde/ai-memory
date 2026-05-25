/**
 * Shared git helpers for Invariant 6 integration tests.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { listAmpManagedProjectRelPaths } from "../../gitignore/paths.js";

export function runGit(projectRoot: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr?.toString() ?? `git ${args.join(" ")} failed`);
  return [result.stdout ?? "", result.stderr ?? ""].filter(Boolean).join("\n");
}

export function initGitRepo(projectRoot: string): void {
  runGit(projectRoot, ["init"]);
  runGit(projectRoot, ["config", "user.email", "amp@test.local"]);
  runGit(projectRoot, ["config", "user.name", "AMP Test"]);
}

export function ampManagedPathsInGitStatus(statusOutput: string): string[] {
  const managedPrefixes = listAmpManagedProjectRelPaths().map((prefix) => prefix.replace(/\/$/, ""));

  return statusOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter((path) =>
      managedPrefixes.some(
        (prefix) => path === prefix || path.startsWith(`${prefix}/`)
      )
    );
}

export function assertCleanAmpGitStatus(projectRoot: string, label: string): void {
  const status = runGit(projectRoot, ["status", "--short", "--untracked-files=all"]);
  assert.deepEqual(
    ampManagedPathsInGitStatus(status),
    [],
    `git status must not list AMP-managed paths ${label}:\n${status}`
  );
}
