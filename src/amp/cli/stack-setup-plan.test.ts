import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

import { runAmpInit } from "./init.js";
import { registerAmpCommands } from "./index.js";
import { resolveLocalKnowledgeDbPath } from "./knowledge-backend.js";
import { resolveAmpRuntimeCliBootstrap } from "./runtime-cli-bootstrap.js";
import {
  formatAmpStackSetupPlanJson,
  formatAmpStackSetupPlanReport,
  runAmpStackSetupPlan,
} from "./stack-setup-plan.js";
import type { GbrainPreflightSpawnFn } from "./checks/gbrain-preflight.js";

const missingGbrainSpawn: GbrainPreflightSpawnFn = ((command: string) => {
  const status = command === "which" || command === "where" ? 1 : 1;
  return { status, stdout: "", stderr: "" };
}) as GbrainPreflightSpawnFn;

const presentGbrainSpawn: GbrainPreflightSpawnFn = ((command: string, args?: string[]) => {
  if (command === "which" || command === "where") {
    return { status: 0, stdout: "/usr/local/bin/gbrain\n", stderr: "" };
  }
  if (command === "gbrain" && args?.[0] === "--version") {
    return { status: 0, stdout: "gbrain 0.41.38\n", stderr: "" };
  }
  if (command === "gbrain" && args?.[0] === "serve") {
    return { status: 0, stdout: "serve help\n", stderr: "" };
  }
  if (command === "gbrain" && args?.[0] === "doctor") {
    return { status: 0, stdout: "{\"ok\":true}\n", stderr: "" };
  }
  return { status: 1, stdout: "", stderr: "" };
}) as GbrainPreflightSpawnFn;

describe("runAmpStackSetupPlan", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-stack-setup-plan-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function initProject(name: string) {
    const projectRoot = join(tempRoot, name);
    const fakeHome = join(tempRoot, `home-${name}`);
    const env = { HOME: fakeHome };
    await runAmpInit({ projectRoot, env });
    return { projectRoot, env, fakeHome };
  }

  it("plans GBrain setup when the binary is missing", async () => {
    const { projectRoot, env, fakeHome } = await initProject("missing-gbrain");

    const result = runAmpStackSetupPlan({
      projectRoot,
      env,
      homedir: () => fakeHome,
      gbrainSpawnFn: missingGbrainSpawn,
    });

    const gbrain = result.actions.find((entry) => entry.id === "gbrain-readiness");
    assert.equal(result.ok, true);
    assert.equal(gbrain?.status, "todo");
    assert.match(gbrain?.label ?? "", /GBrain/);
    assert.match(gbrain?.command ?? "", /gbrain-preflight/);
  });

  it("plans durable local knowledge creation when knowledge.db is absent", async () => {
    const { projectRoot, env, fakeHome } = await initProject("missing-knowledge");

    const result = runAmpStackSetupPlan({
      projectRoot,
      env,
      homedir: () => fakeHome,
      gbrainSpawnFn: presentGbrainSpawn,
    });

    const knowledge = result.actions.find((entry) => entry.id === "local-knowledge");
    assert.equal(knowledge?.status, "todo");
    assert.match(knowledge?.label ?? "", /durable local knowledge/i);
    assert.match(knowledge?.command ?? "", /consolidate/);
  });

  it("plans agent setup when agent wiring is not complete", async () => {
    const { projectRoot, env, fakeHome } = await initProject("agent-wiring");

    const result = runAmpStackSetupPlan({
      projectRoot,
      env,
      homedir: () => fakeHome,
      gbrainSpawnFn: presentGbrainSpawn,
    });

    const agent = result.actions.find((entry) => entry.id === "agent-wiring");
    assert.equal(agent?.status, "todo");
    assert.match(agent?.command ?? "", /agent setup/);
    assert.equal(agent?.automatable, true);
  });

  it("fails closed for invalid backend selection", async () => {
    const { projectRoot, env, fakeHome } = await initProject("invalid-backend");

    const result = runAmpStackSetupPlan({
      projectRoot,
      env,
      homedir: () => fakeHome,
      knowledge: "postgres",
      gbrainSpawnFn: presentGbrainSpawn,
    });

    const backend = result.actions.find((entry) => entry.id === "backend-selection");
    assert.equal(result.ok, false);
    assert.equal(result.evaluatedKnowledgeBackend, "invalid");
    assert.equal(backend?.status, "blocked");
  });

  it("does not open or migrate an existing knowledge.db while planning", async () => {
    const { projectRoot, env, fakeHome } = await initProject("read-only-db");
    const bootstrap = resolveAmpRuntimeCliBootstrap({
      projectRoot,
      env,
      homedir: () => fakeHome,
    });
    assert.equal(bootstrap.ok, true);
    if (!bootstrap.ok) return;

    const knowledgeDbPath = resolveLocalKnowledgeDbPath(bootstrap.runtimeDbPath);
    await writeFile(knowledgeDbPath, "", "utf8");
    const before = await stat(knowledgeDbPath);

    const result = runAmpStackSetupPlan({
      projectRoot,
      env,
      homedir: () => fakeHome,
      gbrainSpawnFn: missingGbrainSpawn,
    });

    const after = await stat(knowledgeDbPath);
    assert.equal(result.ok, true);
    assert.equal(before.size, 0);
    assert.equal(after.size, 0);
  });

  it("formats human and JSON reports", async () => {
    const { projectRoot, env, fakeHome } = await initProject("format");

    const result = runAmpStackSetupPlan({
      projectRoot,
      env,
      homedir: () => fakeHome,
      gbrainSpawnFn: missingGbrainSpawn,
    });

    const report = formatAmpStackSetupPlanReport(result).join("\n");
    assert.match(report, /AMP stack setup plan/);
    assert.match(report, /mode:\s+read-only/);
    assert.match(report, /Actions:/);

    const parsed = JSON.parse(formatAmpStackSetupPlanJson(result));
    assert.equal(parsed.projectRoot, projectRoot);
    assert.ok(Array.isArray(parsed.actions));
    assert.equal(parsed.error, null);
  });
});

describe("registerAmpCommands stack setup plan", () => {
  it("registers amp stack setup plan with knowledge and JSON support", () => {
    const program = new Command().name("ai-memory");
    registerAmpCommands(program);

    const amp = program.commands.find((cmd) => cmd.name() === "amp");
    assert.ok(amp);

    const stack = amp.commands.find((cmd) => cmd.name() === "stack");
    assert.ok(stack, "expected amp stack command group");

    const setup = stack.commands.find((cmd) => cmd.name() === "setup");
    assert.ok(setup, "expected amp stack setup command group");

    const plan = setup.commands.find((cmd) => cmd.name() === "plan");
    assert.ok(plan, "expected amp stack setup plan subcommand");
    assert.match(plan.description(), /ordered read-only setup plan/);
    assert.ok(
      plan.options.some((option) => option.long === "--knowledge"),
      "expected --knowledge option on amp stack setup plan",
    );
    assert.ok(
      plan.options.some((option) => option.long === "--json"),
      "expected --json option on amp stack setup plan",
    );
  });
});
