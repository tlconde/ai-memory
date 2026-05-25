import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAmpInit } from "../cli/init.js";
import {
  ampManagedPathsInGitStatus,
  initGitRepo,
  runGit,
} from "./_helpers/invariant-6-git.js";

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
