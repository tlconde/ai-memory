import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PROJECTION_FILE_KINDS } from "../projection/constants.js";
import { DB_BACKED_MATERIALIZATION_NOT_WIRED } from "../projection/messages.js";
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
});

describe("formatAmpProjectionRenderReport", () => {
  it("formats blocked apply refusal without task IDs", () => {
    const lines = formatAmpProjectionRenderReport({
      projectRoot: "/tmp/demo",
      dryRun: false,
      writes: [],
      ok: false,
      blocked: true,
      error: DB_BACKED_MATERIALIZATION_NOT_WIRED,
    });

    const text = lines.join("\n");
    assert.match(text, /not wired yet/);
    assert.match(text, /materialization is not available yet/);
    assert.equal(text.includes("AMP-PROJ"), false);
  });
});
