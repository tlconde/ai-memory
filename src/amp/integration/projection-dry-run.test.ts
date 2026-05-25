/**
 * Projection dry-run E2E — offline-safe planning without disk materialization.
 *
 * Falsifiable claim: after `amp init` gitignore protection, `amp projection render
 * --dry-run` reports all four canonical paths, writes nothing to disk, and leaves
 * git status free of AMP-managed generated artifacts.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAmpInit } from "../cli/init.js";
import { runAmpProjectionRender } from "../cli/projection.js";
import {
  AMP_GITIGNORE_MARKER,
  AMP_LOCAL_DIR_REL,
  AMP_RUNTIME_DIR_REL,
  DEFAULT_AMP_GITIGNORE_LINES,
  listAmpManagedProjectRelPaths,
} from "../gitignore/paths.js";
import { PROJECTION_FILE_KINDS } from "../projection/constants.js";

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

describe("Projection dry-run E2E", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-projection-dry-run-e2e-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("plans four paths offline without writes or git noise after init protection", async () => {
    const projectRoot = join(tempRoot, "offline-safe");
    const fakeHome = join(tempRoot, "isolated-home");
    await mkdir(projectRoot, { recursive: true });
    initGitRepo(projectRoot);

    const initResult = await runAmpInit({ projectRoot, env: { HOME: fakeHome } });

    assert.equal(initResult.localDirCreated, true);
    assert.equal(initResult.runtimeDirCreated, true);
    assert.deepEqual(initResult.gitignoreEntriesAdded, [...DEFAULT_AMP_GITIGNORE_LINES]);

    const gitignore = await readFile(initResult.gitignorePath, "utf8");
    assert.ok(gitignore.includes(AMP_GITIGNORE_MARKER));
    assert.match(gitignore, new RegExp(`^${AMP_LOCAL_DIR_REL.replace("/", "\\/")}$`, "m"));
    assert.match(gitignore, new RegExp(`^${AMP_RUNTIME_DIR_REL.replace("/", "\\/")}$`, "m"));

    const statusAfterInit = runGit(projectRoot, ["status", "--short", "--untracked-files=all"]);
    assert.deepEqual(
      ampManagedPathsInGitStatus(statusAfterInit),
      [],
      `init must gitignore .amp/local and .amp/runtime:\n${statusAfterInit}`
    );

    const result = await runAmpProjectionRender({
      projectRoot,
      dryRun: true,
      homedir: () => fakeHome,
      env: { HOME: fakeHome },
    });

    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.writes.length, 4);
    assert.deepEqual(
      result.writes.map((write) => write.kind),
      [...PROJECTION_FILE_KINDS]
    );
    assert.deepEqual(
      result.writes.map((write) => write.path),
      [
        join(fakeHome, ".amp", "projection", "global.md"),
        join(fakeHome, ".amp", "runtime", "global.md"),
        join(projectRoot, ".amp", "local", "projection.md"),
        join(projectRoot, ".amp", "local", "runtime.md"),
      ]
    );

    for (const write of result.writes) {
      assert.equal(write.dryRun, true);
      assert.equal(write.wrote, false);
      assert.equal(existsSync(write.path), false, `dry-run must not create ${write.path}`);
    }

    const statusAfterDryRun = runGit(projectRoot, ["status", "--short", "--untracked-files=all"]);
    assert.deepEqual(
      ampManagedPathsInGitStatus(statusAfterDryRun),
      [],
      `git status must not list AMP-managed paths after dry-run:\n${statusAfterDryRun}`
    );
  });
});
