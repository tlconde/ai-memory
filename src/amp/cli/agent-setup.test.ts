import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CURSOR_FROM_AMP_REL } from "../adapters/sas/cursor/adapter.js";
import { CURSOR_PROJECTION_RULE_FILENAME } from "../agent-setup/cursor.js";
import { CLAUDE_PROJECT_FILENAME } from "../agent-setup/claude-code.js";
import { PROJECT_LOCAL_DIR } from "../projection/paths.js";
import { runAmpInit } from "./init.js";
import {
  formatAmpAgentSetupReport,
  isAmpAgentSetupTarget,
  runAmpAgentSetup,
} from "./agent-setup.js";

describe("runAmpAgentSetup", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-agent-setup-cli-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function seedProject(name: string): Promise<string> {
    const projectRoot = join(tempRoot, name);
    await mkdir(projectRoot, { recursive: true });
    await runAmpInit({ projectRoot });
    const localDir = join(projectRoot, PROJECT_LOCAL_DIR);
    await mkdir(localDir, { recursive: true });
    await writeFile(join(localDir, "projection.md"), "# Projection\n", "utf8");
    await writeFile(join(localDir, "runtime.md"), "# Runtime\n", "utf8");
    return projectRoot;
  }

  it("requires project AMP config", async () => {
    const projectRoot = join(tempRoot, "missing-config");
    const result = await runAmpAgentSetup({
      projectRoot,
      target: "claude-code",
      dryRun: true,
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /ai-memory amp init/);
  });

  it("dry-run does not write harness files", async () => {
    const projectRoot = await seedProject("dry-run");

    const result = await runAmpAgentSetup({
      projectRoot,
      target: "claude-code",
      dryRun: true,
    });
    assert.equal(result.ok, true);
    assert.equal(existsSync(join(projectRoot, CLAUDE_PROJECT_FILENAME)), false);
  });

  it("apply for Claude writes CLAUDE.md marker block", async () => {
    const projectRoot = await seedProject("claude-apply");

    const result = await runAmpAgentSetup({
      projectRoot,
      target: "claude-code",
      apply: true,
    });
    assert.equal(result.ok, true);
    const content = await readFile(join(projectRoot, CLAUDE_PROJECT_FILENAME), "utf8");
    assert.match(content, /@\.amp\/local\/projection\.md/);
  });

  it("apply for Cursor writes from-amp mdc", async () => {
    const projectRoot = await seedProject("cursor-apply");

    const result = await runAmpAgentSetup({
      projectRoot,
      target: "cursor",
      apply: true,
    });
    assert.equal(result.ok, true);
    assert.equal(
      existsSync(join(projectRoot, CURSOR_FROM_AMP_REL, CURSOR_PROJECTION_RULE_FILENAME)),
      true
    );
  });

  it("validates setup targets", () => {
    assert.equal(isAmpAgentSetupTarget("claude-code"), true);
    assert.equal(isAmpAgentSetupTarget("cursor"), true);
    assert.equal(isAmpAgentSetupTarget("unknown"), false);
  });

  it("formats dry-run and error reports", () => {
    const dryRun = formatAmpAgentSetupReport({
      projectRoot: "/tmp/demo",
      target: "cursor",
      mode: "dry-run",
      plannedPaths: ["/tmp/demo/.cursor/rules/from-amp/amp-projection.mdc"],
      changed: true,
      ok: true,
      warnings: [],
      errors: [],
    });
    assert.match(dryRun.join("\n"), /dry-run finished/);

    const failed = formatAmpAgentSetupReport({
      projectRoot: "/tmp/demo",
      target: "claude-code",
      mode: "apply",
      plannedPaths: [],
      changed: false,
      ok: false,
      warnings: [],
      errors: ["boom"],
    });
    assert.match(failed.join("\n"), /ERROR boom/);
  });
});
