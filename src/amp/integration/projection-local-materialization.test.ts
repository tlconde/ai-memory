/**
 * Local projection materialization E2E — capture, consolidate, dry-run, apply.
 *
 * Falsifiable claim: an offline project can capture preferences, seed local
 * knowledge, dry-run plan, and apply four projection files under injected
 * AMP_USER_ROOT and gitignored .amp/local without git noise or live gbrain.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir as realHomedir } from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AMP_GITIGNORE_MARKER,
  AMP_LOCAL_DIR_REL,
  AMP_RUNTIME_DIR_REL,
  DEFAULT_AMP_GITIGNORE_LINES,
} from "../gitignore/paths.js";
import {
  applyLocalProjectionsForTest,
  canonicalLocalProjectionPaths,
  createIsolatedAmpTestEnv,
  dryRunLocalProjectionsForTest,
  prepareGitProjectWithAmpInit,
  PROJECTION_FILE_KINDS,
  seedLocalProjectionContent,
} from "./_helpers/local-projection-fixture.js";
import { assertCleanAmpGitStatus } from "./_helpers/invariant-6-git.js";

describe("Local projection materialization E2E", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-projection-local-materialization-e2e-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("captures preference, applies local projections, and keeps git clean", async () => {
    const projectRoot = join(tempRoot, "local-materialization");
    const { env, ampUserRoot, rejectRealHomedir } = createIsolatedAmpTestEnv(
      tempRoot,
      "local-materialization"
    );

    const initResult = await prepareGitProjectWithAmpInit(projectRoot, env);
    assert.equal(initResult.localDirCreated, true);
    assert.equal(initResult.runtimeDirCreated, true);
    assert.deepEqual(initResult.gitignoreEntriesAdded, [...DEFAULT_AMP_GITIGNORE_LINES]);

    const gitignore = await readFile(initResult.gitignorePath, "utf8");
    assert.ok(gitignore.includes(AMP_GITIGNORE_MARKER));
    assert.match(gitignore, new RegExp(`^${AMP_LOCAL_DIR_REL.replace("/", "\\/")}$`, "m"));
    assert.match(gitignore, new RegExp(`^${AMP_RUNTIME_DIR_REL.replace("/", "\\/")}$`, "m"));
    assertCleanAmpGitStatus(projectRoot, "after init");

    const preference = "Prefer explicit return types on exported AMP functions.";
    const runtimeNote = "In-flight runtime note for projection test.";

    const knowledge = await seedLocalProjectionContent({
      projectRoot,
      env,
      homedir: rejectRealHomedir,
      preference,
      runtimeNote,
      capturePattern: "consolidate-between",
    });

    const canonicalPaths = canonicalLocalProjectionPaths(projectRoot, ampUserRoot);

    const dryRunResult = await dryRunLocalProjectionsForTest({
      projectRoot,
      env,
      homedir: rejectRealHomedir,
      knowledge,
    });

    assert.equal(dryRunResult.ok, true);
    assert.equal(dryRunResult.source, "local");
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
      assert.equal(existsSync(write.path), false);
    }
    assertCleanAmpGitStatus(projectRoot, "after local dry-run");

    const applyResult = await applyLocalProjectionsForTest({
      projectRoot,
      env,
      homedir: rejectRealHomedir,
      knowledge,
    });

    assert.equal(applyResult.ok, true);
    assert.equal(applyResult.source, "local");
    assert.equal(applyResult.dryRun, false);
    assert.equal(applyResult.writes.length, 4);

    for (const path of canonicalPaths) {
      assert.equal(existsSync(path), true, `expected ${path} after apply`);
    }

    const projectProjection = await readFile(
      join(projectRoot, ".amp", "local", "projection.md"),
      "utf8"
    );
    const projectRuntime = await readFile(join(projectRoot, ".amp", "local", "runtime.md"), "utf8");

    assert.match(projectProjection, new RegExp(preference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(projectRuntime, new RegExp(runtimeNote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(projectRuntime, /_Project: local-materialization_/);

    const realGlobalProjection = join(realHomedir(), ".amp", "projection", "global.md");
    assert.notEqual(
      applyResult.writes.find((write) => write.kind === "global_projection")?.path,
      realGlobalProjection
    );

    assertCleanAmpGitStatus(projectRoot, "after local apply");
  });
});
