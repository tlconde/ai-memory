/**
 * Projection materialization safety gates E2E — init protection, dry-run planning,
 * and placeholder apply refusal without disk writes or git noise.
 *
 * Falsifiable claim: after `amp init` gitignore protection, dry-run plans all four
 * canonical paths without writes; non-dry-run apply fails before materialization;
 * git status stays clean for AMP-managed project-local paths; global paths resolve
 * via injected AMP_USER_ROOT only (never real ~/.amp).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir as realHomedir } from "node:os";
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
} from "../gitignore/paths.js";
import { PROJECTION_FILE_KINDS } from "../projection/constants.js";
import { DB_BACKED_MATERIALIZATION_NOT_WIRED } from "../projection/messages.js";
import {
  assertCleanAmpGitStatus,
  initGitRepo,
} from "./_helpers/invariant-6-git.js";

describe("Projection materialization safety gates E2E", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-projection-materialization-e2e-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("protects init paths, dry-run plans offline, apply fails before writes, git stays clean", async () => {
    const projectRoot = join(tempRoot, "materialization-safety");
    const fakeHome = join(tempRoot, "isolated-home");
    const ampUserRoot = join(tempRoot, "injected-amp-user-root");
    const injectedEnv = { HOME: fakeHome, AMP_USER_ROOT: ampUserRoot };
    const rejectRealHomedir = (): string => {
      throw new Error("must not resolve real homedir during materialization E2E");
    };

    await mkdir(projectRoot, { recursive: true });
    initGitRepo(projectRoot);

    const initResult = await runAmpInit({ projectRoot, env: injectedEnv });

    assert.equal(initResult.localDirCreated, true);
    assert.equal(initResult.runtimeDirCreated, true);
    assert.deepEqual(initResult.gitignoreEntriesAdded, [...DEFAULT_AMP_GITIGNORE_LINES]);

    const gitignore = await readFile(initResult.gitignorePath, "utf8");
    assert.ok(gitignore.includes(AMP_GITIGNORE_MARKER));
    assert.match(gitignore, new RegExp(`^${AMP_LOCAL_DIR_REL.replace("/", "\\/")}$`, "m"));
    assert.match(gitignore, new RegExp(`^${AMP_RUNTIME_DIR_REL.replace("/", "\\/")}$`, "m"));

    assertCleanAmpGitStatus(projectRoot, "after init protection");

    const canonicalPaths = [
      join(ampUserRoot, "projection", "global.md"),
      join(ampUserRoot, "runtime", "global.md"),
      join(projectRoot, ".amp", "local", "projection.md"),
      join(projectRoot, ".amp", "local", "runtime.md"),
    ];

    const dryRunResult = await runAmpProjectionRender({
      projectRoot,
      dryRun: true,
      homedir: rejectRealHomedir,
      env: injectedEnv,
    });

    assert.equal(dryRunResult.ok, true);
    assert.equal(dryRunResult.dryRun, true);
    assert.equal(dryRunResult.writes.length, 4);
    assert.deepEqual(
      dryRunResult.writes.map((write) => write.kind),
      [...PROJECTION_FILE_KINDS]
    );
    assert.deepEqual(
      dryRunResult.writes.map((write) => write.path),
      canonicalPaths
    );

    for (const write of dryRunResult.writes) {
      assert.equal(write.dryRun, true);
      assert.equal(write.wrote, false);
      assert.equal(existsSync(write.path), false, `dry-run must not create ${write.path}`);
    }

    assertCleanAmpGitStatus(projectRoot, "after dry-run");

    const applyResult = await runAmpProjectionRender({
      projectRoot,
      source: "placeholder",
      apply: true,
      homedir: rejectRealHomedir,
      env: injectedEnv,
    });

    assert.equal(applyResult.ok, false);
    assert.equal(applyResult.dryRun, false);
    assert.equal(applyResult.blocked, true);
    assert.equal(applyResult.error, DB_BACKED_MATERIALIZATION_NOT_WIRED);
    assert.equal(applyResult.budget, undefined);
    assert.equal(applyResult.writes.length, 0);

    for (const path of canonicalPaths) {
      assert.equal(existsSync(path), false, `apply must not create ${path}`);
    }

    const realGlobalProjection = join(realHomedir(), ".amp", "projection", "global.md");
    const realGlobalRuntime = join(realHomedir(), ".amp", "runtime", "global.md");
    if (existsSync(realGlobalProjection)) {
      assert.notEqual(
        dryRunResult.writes.find((write) => write.kind === "global_projection")?.path,
        realGlobalProjection
      );
    }
    if (existsSync(realGlobalRuntime)) {
      assert.notEqual(
        dryRunResult.writes.find((write) => write.kind === "global_runtime")?.path,
        realGlobalRuntime
      );
    }

    assertCleanAmpGitStatus(projectRoot, "after blocked apply");
  });
});
