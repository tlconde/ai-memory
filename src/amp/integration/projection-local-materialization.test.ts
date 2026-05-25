/**
 * Local projection materialization E2E — capture, consolidate, dry-run, apply.
 *
 * Falsifiable claim: an offline project can capture preferences, seed local
 * knowledge, dry-run plan, and apply four projection files under injected
 * AMP_USER_ROOT and gitignored .amp/local without git noise or live gbrain.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir as realHomedir } from "node:os";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { runAmpCapture } from "../cli/capture.js";
import { openRuntimeStore, resolveCliProjectContext } from "../cli/cli-context.js";
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
import { consolidateNow } from "../substrate/storage/consolidation-minimal.js";

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

function assertCleanAmpGitStatus(projectRoot: string, label: string): void {
  const status = runGit(projectRoot, ["status", "--short", "--untracked-files=all"]);
  assert.deepEqual(
    ampManagedPathsInGitStatus(status),
    [],
    `git status must not list AMP-managed paths ${label}:\n${status}`
  );
}

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
    const fakeHome = join(tempRoot, "isolated-home");
    const ampUserRoot = join(tempRoot, "injected-amp-user-root");
    const env = {
      HOME: fakeHome,
      AMP_USER_ROOT: ampUserRoot,
      AMP_KNOWLEDGE_BACKEND: "in-memory",
    };
    const rejectRealHomedir = (): string => {
      throw new Error("must not resolve real homedir during local materialization E2E");
    };

    await mkdir(projectRoot, { recursive: true });
    initGitRepo(projectRoot);

    const initResult = await runAmpInit({ projectRoot, env });
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

    runAmpCapture({
      projectRoot,
      content: preference,
      scope: "project",
      env,
      homedir: rejectRealHomedir,
    });

    const context = resolveCliProjectContext({
      projectRoot,
      env,
      homedir: rejectRealHomedir,
    });
    const runtime = openRuntimeStore(context.runtimeDbPath);
    const knowledge = new InMemoryKnowledgeStore();
    const consolidation = consolidateNow(runtime, knowledge);
    assert.equal(consolidation.processed, 1);

    runAmpCapture({
      projectRoot,
      content: runtimeNote,
      scope: "project",
      env,
      homedir: rejectRealHomedir,
    });
    runtime.close();

    const canonicalPaths = [
      join(ampUserRoot, "projection", "global.md"),
      join(ampUserRoot, "runtime", "global.md"),
      join(projectRoot, ".amp", "local", "projection.md"),
      join(projectRoot, ".amp", "local", "runtime.md"),
    ];

    const dryRunResult = await runAmpProjectionRender({
      projectRoot,
      source: "local",
      dryRun: true,
      homedir: rejectRealHomedir,
      env,
      knowledgeStore: knowledge,
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

    const applyResult = await runAmpProjectionRender({
      projectRoot,
      source: "local",
      apply: true,
      homedir: rejectRealHomedir,
      env,
      knowledgeStore: knowledge,
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
