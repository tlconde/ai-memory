import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAmpInit } from "../cli/init.js";
import { listAmpManagedProjectRelPaths } from "../gitignore/paths.js";

function runGit(projectRoot: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr?.toString() ?? `git ${args.join(" ")} failed`);
  return [result.stdout ?? "", result.stderr ?? ""].filter(Boolean).join("\n");
}

function initGitRepo(projectRoot: string): void {
  runGit(projectRoot, ["init"]);
  runGit(projectRoot, ["config", "user.email", "amp@test.local"]);
  runGit(projectRoot, ["config", "user.name", "AMP Test"]);
}

function ampManagedPathsInGitStatus(statusOutput: string): string[] {
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

describe("Invariant 6 git status protection", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-inv6-git-status-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("keeps AMP-managed paths out of git status after init and artifact touch", async () => {
    const projectRoot = join(tempRoot, "managed-paths-hidden");
    await mkdir(projectRoot, { recursive: true });
    initGitRepo(projectRoot);

    await runAmpInit({ projectRoot });

    await writeFile(join(projectRoot, ".amp", "local", ".probe"), "probe\n", "utf8");
    await writeFile(join(projectRoot, ".amp", "runtime", "runtime.db"), "sqlite\n", "utf8");

    const status = runGit(projectRoot, ["status", "--short", "--untracked-files=all"]);
    const managedHits = ampManagedPathsInGitStatus(status);

    assert.deepEqual(
      managedHits,
      [],
      `git status must not list AMP-managed paths:\n${status}`
    );
  });
});
