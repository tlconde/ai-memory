import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AMP_LOCAL_DIR_REL, AMP_RUNTIME_DIR_REL } from "./paths.js";
import { checkAmpGitignoreProtection } from "./check.js";
import { ensureAmpGitignoreEntries } from "./ensure.js";

async function makeProjectDir(tempRoot: string, name: string): Promise<string> {
  const projectRoot = join(tempRoot, name);
  await mkdir(projectRoot, { recursive: true });
  return projectRoot;
}

function runGit(projectRoot: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr?.toString() ?? `git ${args.join(" ")} failed`);
}

function initGitRepo(projectRoot: string): void {
  runGit(projectRoot, ["init"]);
  runGit(projectRoot, ["config", "user.email", "amp@test.local"]);
  runGit(projectRoot, ["config", "user.name", "AMP Test"]);
}

describe("checkAmpGitignoreProtection", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-gitignore-check-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("skips cleanly outside a git repository", async () => {
    const projectRoot = await makeProjectDir(tempRoot, "not-git");
    const result = checkAmpGitignoreProtection(projectRoot);

    assert.equal(result.insideGitWorkTree, false);
    assert.equal(result.protected, true);
    assert.deepEqual(result.ignoredPaths, []);
    assert.deepEqual(result.unprotectedPaths, []);
    assert.deepEqual(result.trackablePaths, []);
  });

  it("reports protected when AMP entries are git-ignored", async () => {
    const projectRoot = await makeProjectDir(tempRoot, "protected");
    initGitRepo(projectRoot);
    await ensureAmpGitignoreEntries(projectRoot);

    const result = checkAmpGitignoreProtection(projectRoot);

    assert.equal(result.insideGitWorkTree, true);
    assert.equal(result.protected, true);
    assert.deepEqual(result.unprotectedPaths, []);
    assert.deepEqual(result.trackablePaths, []);
    assert.ok(result.ignoredPaths.includes(AMP_LOCAL_DIR_REL));
    assert.ok(result.ignoredPaths.includes(AMP_RUNTIME_DIR_REL));
  });

  it("reports unprotected paths when gitignore entries are missing", async () => {
    const projectRoot = await makeProjectDir(tempRoot, "unprotected");
    initGitRepo(projectRoot);

    const result = checkAmpGitignoreProtection(projectRoot);

    assert.equal(result.insideGitWorkTree, true);
    assert.equal(result.protected, false);
    assert.deepEqual(result.ignoredPaths, []);
    assert.deepEqual(result.unprotectedPaths, [AMP_LOCAL_DIR_REL, AMP_RUNTIME_DIR_REL]);
  });

  it("detects force-added trackable AMP artifacts", async () => {
    const projectRoot = await makeProjectDir(tempRoot, "trackable");
    initGitRepo(projectRoot);
    await ensureAmpGitignoreEntries(projectRoot);

    const artifactPath = join(projectRoot, ".amp", "local", "probe.txt");
    await mkdir(join(projectRoot, ".amp", "local"), { recursive: true });
    await writeFile(artifactPath, "probe", "utf8");
    runGit(projectRoot, ["add", "-f", ".amp/local/probe.txt"]);
    runGit(projectRoot, ["commit", "-m", "track amp artifact"]);

    const result = checkAmpGitignoreProtection(projectRoot);

    assert.equal(result.protected, false);
    assert.ok(result.trackablePaths.includes(".amp/local/probe.txt"));
  });

  it("detects partially missing gitignore coverage", async () => {
    const projectRoot = await makeProjectDir(tempRoot, "partial");
    initGitRepo(projectRoot);
    await writeFile(join(projectRoot, ".gitignore"), `${AMP_LOCAL_DIR_REL}\n`, "utf8");

    const result = checkAmpGitignoreProtection(projectRoot);

    assert.equal(result.protected, false);
    assert.deepEqual(result.ignoredPaths, [AMP_LOCAL_DIR_REL]);
    assert.deepEqual(result.unprotectedPaths, [AMP_RUNTIME_DIR_REL]);
  });
});
