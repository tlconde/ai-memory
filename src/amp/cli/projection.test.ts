import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { createFrame } from "../core/frame-schema.js";
import { PROJECTION_FILE_KINDS } from "../projection/constants.js";
import {
  DB_BACKED_MATERIALIZATION_NOT_WIRED,
  LOCAL_PROJECTION_KNOWLEDGE_UNAVAILABLE,
} from "../projection/messages.js";
import { capturePreference } from "../substrate/capture-preference.js";
import { openRuntimeStore, resolveCliProjectContext } from "./cli-context.js";
import { runAmpInit } from "./init.js";
import {
  formatAmpProjectionRenderReport,
  runAmpProjectionRender,
} from "./projection.js";

describe("runAmpProjectionRender", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-projection-cli-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("dry-run plans all four projection paths without writing files", async () => {
    const projectRoot = join(tempRoot, "dry-run-all");
    const fakeHome = join(tempRoot, "home-dry-run-all");
    await runAmpInit({ projectRoot, env: { HOME: fakeHome } });

    const result = await runAmpProjectionRender({
      projectRoot,
      dryRun: true,
      homedir: () => fakeHome,
    });

    assert.equal(result.ok, true);
    assert.equal(result.source, "placeholder");
    assert.equal(result.dryRun, true);
    assert.equal(result.projectRef, "dry-run-all");
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
      assert.equal(existsSync(write.path), false);
    }

    assert.ok(result.budget);
    assert.equal(result.budget.success, true);
    assert.equal(result.budget.combined.status, "ok");
  });

  it("refuses non-dry-run apply when placeholder source does not support apply", async () => {
    const projectRoot = join(tempRoot, "no-dry-run");
    await runAmpInit({ projectRoot });

    const result = await runAmpProjectionRender({ projectRoot, dryRun: false });

    assert.equal(result.ok, false);
    assert.equal(result.source, "placeholder");
    assert.equal(result.dryRun, false);
    assert.equal(result.blocked, true);
    assert.equal(result.error, DB_BACKED_MATERIALIZATION_NOT_WIRED);
    assert.equal(result.budget, undefined);
    assert.equal(result.writes.length, 0);
  });

  it("requires project AMP config", async () => {
    const projectRoot = join(tempRoot, "missing-config");

    const result = await runAmpProjectionRender({
      projectRoot,
      dryRun: true,
    });

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /Project AMP config not found/);
    assert.equal(result.budget, undefined);
    assert.equal(result.writes.length, 0);
  });

  it("reports budget status in formatted output", async () => {
    const projectRoot = join(tempRoot, "budget-report");
    const fakeHome = join(tempRoot, "home-budget-report");
    await runAmpInit({ projectRoot });

    const result = await runAmpProjectionRender({
      projectRoot,
      dryRun: true,
      homedir: () => fakeHome,
    });
    const lines = formatAmpProjectionRenderReport(result);
    const text = lines.join("\n");

    assert.match(text, /source=placeholder/);
    assert.match(text, /Budget:/);
    assert.match(text, /combined: 0\/2000 \(ok\)/);
    assert.match(text, /Planned writes:/);
    assert.match(text, /global_projection ->/);
    assert.match(text, /project_runtime ->/);
    assert.match(text, /OK Projection dry-run finished/);
  });

  it("does not touch real homedir when homedir is injected", async () => {
    const projectRoot = join(tempRoot, "injected-home");
    const fakeHome = join(tempRoot, "isolated-home");
    await runAmpInit({ projectRoot });

    await runAmpProjectionRender({
      projectRoot,
      dryRun: true,
      homedir: () => fakeHome,
    });

    assert.equal(existsSync(join(fakeHome, ".amp", "projection", "global.md")), false);
    assert.equal(existsSync(join(projectRoot, ".amp", "local", "projection.md")), false);
  });

  it("local dry-run plans four writes with injected knowledge store", async () => {
    const projectRoot = join(tempRoot, "local-dry-run");
    const ampUserRoot = join(tempRoot, "amp-user-local-dry-run");
    const fakeHome = join(tempRoot, "home-local-dry-run");
    const env = { HOME: fakeHome, AMP_USER_ROOT: ampUserRoot, AMP_KNOWLEDGE_BACKEND: "in-memory" };
    await runAmpInit({ projectRoot, env });

    const knowledge = new InMemoryKnowledgeStore();
    knowledge.write([
      createFrame({
        id: "local-pref",
        kind: "semantic",
        content: "Local dry-run preference.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "project", project_ref: "local-dry-run" },
        curation_mode: "personal",
      }),
    ]);

    const result = await runAmpProjectionRender({
      projectRoot,
      source: "local",
      dryRun: true,
      homedir: () => fakeHome,
      env,
      knowledgeStore: knowledge,
    });

    assert.equal(result.ok, true);
    assert.equal(result.source, "local");
    assert.equal(result.dryRun, true);
    assert.equal(result.writes.length, 4);
    assert.deepEqual(
      result.writes.map((write) => write.path),
      [
        join(ampUserRoot, "projection", "global.md"),
        join(ampUserRoot, "runtime", "global.md"),
        join(projectRoot, ".amp", "local", "projection.md"),
        join(projectRoot, ".amp", "local", "runtime.md"),
      ]
    );
    for (const write of result.writes) {
      assert.equal(write.dryRun, true);
      assert.equal(existsSync(write.path), false);
    }
  });

  it("local apply writes four projection files under injected AMP_USER_ROOT and project .amp/local", async () => {
    const projectRoot = join(tempRoot, "local-apply");
    const ampUserRoot = join(tempRoot, "amp-user-local-apply");
    const fakeHome = join(tempRoot, "home-local-apply");
    const env = { HOME: fakeHome, AMP_USER_ROOT: ampUserRoot, AMP_KNOWLEDGE_BACKEND: "in-memory" };
    await runAmpInit({ projectRoot, env });

    const context = resolveCliProjectContext({ projectRoot, env, homedir: () => fakeHome });
    const runtime = openRuntimeStore(context.runtimeDbPath);
    capturePreference(runtime, {
      content: "Runtime note for local apply.",
      scope: "project",
      projectRef: "local-apply",
    });
    runtime.close();

    const knowledge = new InMemoryKnowledgeStore();
    knowledge.write([
      createFrame({
        id: "apply-pref",
        kind: "semantic",
        content: "Local apply preference.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "project", project_ref: "local-apply" },
        curation_mode: "personal",
      }),
    ]);

    const result = await runAmpProjectionRender({
      projectRoot,
      source: "local",
      apply: true,
      homedir: () => fakeHome,
      env,
      knowledgeStore: knowledge,
    });

    assert.equal(result.ok, true);
    assert.equal(result.source, "local");
    assert.equal(result.dryRun, false);
    assert.equal(result.writes.length, 4);

    const canonicalPaths = [
      join(ampUserRoot, "projection", "global.md"),
      join(ampUserRoot, "runtime", "global.md"),
      join(projectRoot, ".amp", "local", "projection.md"),
      join(projectRoot, ".amp", "local", "runtime.md"),
    ];

    for (const path of canonicalPaths) {
      assert.equal(existsSync(path), true, `expected ${path} to exist`);
    }

    const projectProjection = await readFile(
      join(projectRoot, ".amp", "local", "projection.md"),
      "utf8"
    );
    const projectRuntime = await readFile(join(projectRoot, ".amp", "local", "runtime.md"), "utf8");
    assert.match(projectProjection, /Local apply preference\./);
    assert.match(projectRuntime, /Runtime note for local apply\./);
  });

  it("fails local source when offline knowledge backend is unavailable", async () => {
    const projectRoot = join(tempRoot, "local-no-knowledge");
    await runAmpInit({ projectRoot });

    const result = await runAmpProjectionRender({
      projectRoot,
      source: "local",
      dryRun: true,
      env: { AMP_KNOWLEDGE_BACKEND: "gbrain" },
    });

    assert.equal(result.ok, false);
    assert.equal(result.source, "local");
    assert.equal(result.error, LOCAL_PROJECTION_KNOWLEDGE_UNAVAILABLE);
    assert.match(result.error ?? "", /placeholder --dry-run/);
    assert.equal(result.writes.length, 0);
  });
});

describe("formatAmpProjectionRenderReport", () => {
  it("formats blocked apply refusal without task IDs", () => {
    const lines = formatAmpProjectionRenderReport({
      projectRoot: "/tmp/demo",
      source: "placeholder",
      dryRun: false,
      writes: [],
      ok: false,
      blocked: true,
      error: DB_BACKED_MATERIALIZATION_NOT_WIRED,
    });

    const text = lines.join("\n");
    assert.match(text, /source=placeholder/);
    assert.match(text, /not wired yet/);
    assert.match(text, /materialization is not available yet/);
    assert.equal(text.includes("AMP-PROJ"), false);
  });
});
