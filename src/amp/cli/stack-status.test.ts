import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

import { runAmpInit } from "./init.js";
import { registerAmpCommands } from "./index.js";
import {
  formatAmpStackStatusJson,
  formatAmpStackStatusReport,
  runAmpStackStatus,
} from "./stack-status.js";
import type { GbrainPreflightSpawnFn } from "./checks/gbrain-preflight.js";
import { resolveLocalKnowledgeDbPath } from "./knowledge-backend.js";
import { resolveAmpRuntimeCliBootstrap } from "./runtime-cli-bootstrap.js";

const missingGbrainSpawn: GbrainPreflightSpawnFn = ((command: string) => {
  const status = command === "which" || command === "where" ? 1 : 1;
  return { status, stdout: "", stderr: "" };
}) as GbrainPreflightSpawnFn;

describe("runAmpStackStatus", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-stack-status-"));
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

  it("reports a read-only scaffold/control-plane view after init", async () => {
    const { projectRoot, env, fakeHome } = await initProject("after-init");

    const result = runAmpStackStatus({
      projectRoot,
      env,
      homedir: () => fakeHome,
      gbrainSpawnFn: missingGbrainSpawn,
    });

    assert.equal(result.ok, true);
    assert.equal(result.mode, "read-only");
    assert.equal(result.role, "scaffold-control-plane");
    assert.ok(result.components.length >= 5);
    assert.ok(result.components.some((component) => component.id === "amp-doctor"));
    assert.ok(result.components.some((component) => component.id === "local-knowledge"));
    assert.ok(result.components.some((component) => component.id === "gbrain"));
    assert.ok(result.components.some((component) => component.id === "hermes"));
    assert.ok(result.components.some((component) => component.id === "agent-wiring"));
    assert.equal(result.blockedCount, 0);
    assert.ok(result.needsActionCount > 0);
  });

  it("fails closed when project bootstrap is missing", () => {
    const projectRoot = join(tempRoot, "missing-config");

    const result = runAmpStackStatus({
      projectRoot,
      gbrainSpawnFn: missingGbrainSpawn,
    });

    assert.equal(result.ok, false);
    assert.ok(result.blockedCount >= 1);
    const knowledge = result.components.find((component) => component.id === "local-knowledge");
    assert.equal(knowledge?.status, "blocked");
    assert.match(knowledge?.nextAction ?? "", /amp init/);
  });

  it("formats human output with next actions and no mutation claim", async () => {
    const { projectRoot, env, fakeHome } = await initProject("human-output");

    const result = runAmpStackStatus({
      projectRoot,
      env,
      homedir: () => fakeHome,
      gbrainSpawnFn: missingGbrainSpawn,
    });
    const output = formatAmpStackStatusReport(result).join("\n");

    assert.match(output, /AMP stack status/);
    assert.match(output, /scaffold\/control plane/i);
    assert.match(output, /mode:\s+read-only/);
    assert.match(output, /gbrain/i);
    assert.match(output, /next:/i);
    assert.doesNotMatch(output, /mutat/i);
  });

  it("JSON output is parseable and exposes component statuses", async () => {
    const { projectRoot, env, fakeHome } = await initProject("json-output");

    const result = runAmpStackStatus({
      projectRoot,
      env,
      homedir: () => fakeHome,
      gbrainSpawnFn: missingGbrainSpawn,
    });
    const parsed = JSON.parse(formatAmpStackStatusJson(result));

    assert.equal(parsed.ok, true);
    assert.equal(parsed.role, "scaffold-control-plane");
    assert.equal(parsed.mode, "read-only");
    assert.ok(Array.isArray(parsed.components));
    assert.equal(typeof parsed.needsActionCount, "number");
    assert.equal(parsed.error, null);
  });

  it("does not open or migrate an existing knowledge.db while checking status", async () => {
    const { projectRoot, env, fakeHome } = await initProject("read-only-knowledge-db");
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

    const result = runAmpStackStatus({
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
});

describe("registerAmpCommands stack status", () => {
  it("registers amp stack status with JSON support", () => {
    const program = new Command().name("ai-memory");
    registerAmpCommands(program);

    const amp = program.commands.find((cmd) => cmd.name() === "amp");
    assert.ok(amp);

    const stack = amp.commands.find((cmd) => cmd.name() === "stack");
    assert.ok(stack, "expected amp stack command group");
    assert.match(stack.description(), /scaffold/i);

    const status = stack.commands.find((cmd) => cmd.name() === "status");
    assert.ok(status, "expected amp stack status subcommand");
    assert.match(status.description(), /read-only/i);
    assert.ok(
      status.options.some((option) => option.long === "--json"),
      "expected --json option on amp stack status",
    );
  });
});
