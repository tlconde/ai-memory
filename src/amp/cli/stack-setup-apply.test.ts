import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

import { CURSOR_FROM_AMP_REL } from "../adapters/sas/cursor/adapter.js";
import { CURSOR_PROJECTION_RULE_FILENAME } from "../agent-setup/cursor.js";
import { CLAUDE_PROJECT_FILENAME } from "../agent-setup/claude-code.js";
import { projectProjectionPath, projectRuntimePath } from "../projection/paths.js";
import { registerAmpCommands } from "./index.js";
import { resolveLocalKnowledgeDbPath } from "./knowledge-backend.js";
import { resolveAmpRuntimeCliBootstrap } from "./runtime-cli-bootstrap.js";
import {
  formatAmpStackSetupApplyJson,
  formatAmpStackSetupApplyReport,
  isAmpStackSetupApplyTarget,
  runAmpStackSetupApply,
} from "./stack-setup-apply.js";

describe("runAmpStackSetupApply", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-stack-setup-apply-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("applies init, local projection, and all agent wiring by default", async () => {
    const projectRoot = join(tempRoot, "all-default");
    const fakeHome = join(tempRoot, "home-all-default");
    const env = { HOME: fakeHome };

    const result = await runAmpStackSetupApply({
      projectRoot,
      env,
      homedir: () => fakeHome,
    });

    assert.equal(result.ok, true);
    assert.equal(result.target, "all");
    assert.equal(result.agents.length, 3);
    assert.equal(existsSync(result.init.configPath), true);
    assert.equal(existsSync(projectProjectionPath(projectRoot)), true);
    assert.equal(existsSync(projectRuntimePath(projectRoot)), true);
    assert.equal(existsSync(join(projectRoot, CLAUDE_PROJECT_FILENAME)), true);
    assert.equal(
      existsSync(join(projectRoot, CURSOR_FROM_AMP_REL, CURSOR_PROJECTION_RULE_FILENAME)),
      true
    );
    assert.equal(existsSync(join(projectRoot, "AGENTS.md")), true);

    const bootstrap = resolveAmpRuntimeCliBootstrap({
      projectRoot,
      env,
      homedir: () => fakeHome,
    });
    assert.equal(bootstrap.ok, true);
    if (!bootstrap.ok) return;
    assert.equal(existsSync(resolveLocalKnowledgeDbPath(bootstrap.runtimeDbPath)), true);
  });

  it("can apply a single agent target", async () => {
    const projectRoot = join(tempRoot, "codex-only");
    const fakeHome = join(tempRoot, "home-codex-only");

    const result = await runAmpStackSetupApply({
      projectRoot,
      target: "codex",
      env: { HOME: fakeHome },
      homedir: () => fakeHome,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.agents.map((agent) => agent.target),
      ["codex"]
    );
    const agentsMd = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
    assert.match(agentsMd, /## AMP Project Projection/);
    assert.equal(existsSync(join(projectRoot, CLAUDE_PROJECT_FILENAME)), false);
  });

  it("is idempotent after the first apply", async () => {
    const projectRoot = join(tempRoot, "idempotent");
    const fakeHome = join(tempRoot, "home-idempotent");
    const env = { HOME: fakeHome };

    const first = await runAmpStackSetupApply({
      projectRoot,
      env,
      homedir: () => fakeHome,
    });
    const second = await runAmpStackSetupApply({
      projectRoot,
      env,
      homedir: () => fakeHome,
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.init.configSkippedExisting, true);
    assert.equal(second.agents.every((agent) => agent.ok), true);
  });

  it("formats human and JSON reports without claiming external installs or live gbrain access", async () => {
    const projectRoot = join(tempRoot, "format");
    const fakeHome = join(tempRoot, "home-format");
    const result = await runAmpStackSetupApply({
      projectRoot,
      target: "claude-code",
      env: { HOME: fakeHome },
      homedir: () => fakeHome,
    });

    const report = formatAmpStackSetupApplyReport(result).join("\n");
    assert.match(report, /AMP stack setup apply/);
    assert.match(report, /liveGbrainTouched: false/);
    assert.match(report, /externalInstalls: false/);

    const parsed = JSON.parse(formatAmpStackSetupApplyJson(result));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.target, "claude-code");
    assert.equal(parsed.error, null);
  });

  it("validates apply targets", () => {
    assert.equal(isAmpStackSetupApplyTarget("all"), true);
    assert.equal(isAmpStackSetupApplyTarget("claude-code"), true);
    assert.equal(isAmpStackSetupApplyTarget("cursor"), true);
    assert.equal(isAmpStackSetupApplyTarget("codex"), true);
    assert.equal(isAmpStackSetupApplyTarget("gbrain"), false);
  });

  it("rejects invalid targets before mutating local files", async () => {
    const projectRoot = join(tempRoot, "invalid-target");

    const result = await runAmpStackSetupApply({
      projectRoot,
      target: "gbrain" as never,
    });

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /Invalid stack setup target/);
    assert.equal(result.init, undefined);
    assert.equal(result.projection, undefined);
    assert.deepEqual(result.agents, []);
    assert.equal(existsSync(join(projectRoot, ".amp", "config.yaml")), false);
  });
});

describe("registerAmpCommands stack setup apply", () => {
  it("registers amp stack setup apply with target and JSON support", () => {
    const program = new Command().name("ai-memory");
    registerAmpCommands(program);

    const amp = program.commands.find((cmd) => cmd.name() === "amp");
    assert.ok(amp);

    const stack = amp.commands.find((cmd) => cmd.name() === "stack");
    assert.ok(stack, "expected amp stack command group");

    const setup = stack.commands.find((cmd) => cmd.name() === "setup");
    assert.ok(setup, "expected amp stack setup command group");

    const apply = setup.commands.find((cmd) => cmd.name() === "apply");
    assert.ok(apply, "expected amp stack setup apply subcommand");
    assert.match(apply.description(), /safe local AMP stack setup/);
    assert.ok(
      apply.options.some((option) => option.long === "--target"),
      "expected --target option on amp stack setup apply",
    );
    assert.ok(
      apply.options.some((option) => option.long === "--json"),
      "expected --json option on amp stack setup apply",
    );
  });
});
