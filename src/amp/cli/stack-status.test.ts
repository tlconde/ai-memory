import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

import { runAmpInit } from "./init.js";
import { registerAmpCommands } from "./index.js";
import {
  formatAmpStackMapReport,
  formatAmpStackStatusJson,
  formatAmpStackStatusReport,
  formatAmpStackVerifyJson,
  formatAmpStackVerifyReport,
  renderAmpStackMapHtml,
  runAmpStackMap,
  runAmpStackStatus,
  runAmpStackVerify,
} from "./stack-status.js";
import type { GbrainPreflightSpawnFn } from "./checks/gbrain-preflight.js";
import { resolveLocalKnowledgeDbPath } from "./knowledge-backend.js";
import { resolveAmpRuntimeCliBootstrap } from "./runtime-cli-bootstrap.js";

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

const warningGbrainSpawn: GbrainPreflightSpawnFn = ((command: string, args?: string[]) => {
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
    return { status: 1, stdout: "reported warnings; review migration state\n", stderr: "" };
  }
  return { status: 1, stdout: "", stderr: "" };
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
    assert.equal(result.primaryBackend, "gbrain");
    assert.equal(result.evaluatedKnowledgeBackend, "gbrain");
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
    assert.match(output, /primaryBackend:\s+gbrain/);
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
    assert.equal(parsed.primaryBackend, "gbrain");
    assert.equal(parsed.evaluatedKnowledgeBackend, "gbrain");
    assert.ok(Array.isArray(parsed.components));
    assert.equal(typeof parsed.needsActionCount, "number");
    assert.equal(parsed.error, null);
  });

  it("passes explicit backend selection into gbrain preflight", async () => {
    const { projectRoot, env, fakeHome } = await initProject("fake-gbrain-backend");

    const result = runAmpStackStatus({
      projectRoot,
      env,
      homedir: () => fakeHome,
      knowledge: "fake-gbrain",
      gbrainSpawnFn: presentGbrainSpawn,
    });

    assert.equal(result.primaryBackend, "gbrain");
    assert.equal(result.evaluatedKnowledgeBackend, "fake-gbrain");
    const gbrain = result.components.find((component) => component.id === "gbrain");
    assert.equal(gbrain?.status, "needs_action");
    assert.match(gbrain?.summary ?? "", /warning/);
  });

  it("marks invalid backend selection without pretending gbrain was evaluated", async () => {
    const { projectRoot, env, fakeHome } = await initProject("invalid-backend");

    const result = runAmpStackStatus({
      projectRoot,
      env,
      homedir: () => fakeHome,
      knowledge: "postgres",
      gbrainSpawnFn: presentGbrainSpawn,
    });

    assert.equal(result.ok, false);
    assert.equal(result.primaryBackend, "gbrain");
    assert.equal(result.requestedKnowledgeBackend, "postgres");
    assert.equal(result.evaluatedKnowledgeBackend, "invalid");
    assert.ok(result.components.some((component) => component.status === "blocked"));
  });

  it("marks invalid env backend selection without pretending gbrain was evaluated", async () => {
    const { projectRoot, env, fakeHome } = await initProject("invalid-env-backend");

    const result = runAmpStackStatus({
      projectRoot,
      env: { ...env, AMP_KNOWLEDGE_BACKEND: "postgres" },
      homedir: () => fakeHome,
      gbrainSpawnFn: presentGbrainSpawn,
    });

    assert.equal(result.ok, false);
    assert.equal(result.primaryBackend, "gbrain");
    assert.equal(result.requestedKnowledgeBackend, undefined);
    assert.equal(result.evaluatedKnowledgeBackend, "invalid");
    assert.ok(result.components.some((component) => component.status === "blocked"));
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
    assert.ok(
      status.options.some((option) => option.long === "--knowledge"),
      "expected --knowledge option on amp stack status",
    );
  });
});

describe("runAmpStackMap", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-stack-map-"));
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

  it("renders a self-contained visual HTML map from stack status", async () => {
    const { projectRoot, env, fakeHome } = await initProject("html-preview");

    const result = runAmpStackMap({
      projectRoot,
      env,
      homedir: () => fakeHome,
      gbrainSpawnFn: missingGbrainSpawn,
    });

    assert.equal(result.ok, true);
    assert.equal(result.wrote, false);
    assert.equal(result.outputPath, undefined);
    assert.match(result.html, /<!doctype html>/i);
    assert.match(result.html, /AMP Stack Map/);
    assert.match(result.html, /Primary backend/);
    assert.match(result.html, /gbrain/);
    assert.match(result.html, /GBrain backend/);
    assert.match(result.html, /Hermes discovery/);
    assert.match(result.html, /Agent wiring/);
    assert.match(result.html, /scaffold-control-plane/);
    assert.doesNotMatch(result.html, /<script/i);
    assert.deepEqual(formatAmpStackMapReport(result), [result.html]);
  });

  it("writes the map only when an output path is provided", async () => {
    const { projectRoot, env, fakeHome } = await initProject("html-write");
    const outputPath = join(projectRoot, "stack-map.html");

    const result = runAmpStackMap({
      projectRoot,
      env,
      homedir: () => fakeHome,
      gbrainSpawnFn: missingGbrainSpawn,
      outputPath,
    });

    assert.equal(result.ok, true);
    assert.equal(result.wrote, true);
    assert.equal(result.outputPath, outputPath);

    const written = await readFile(outputPath, "utf8");
    assert.equal(written, result.html);
    assert.match(formatAmpStackMapReport(result).join("\n"), /output:/);
  });

  it("does not open or migrate an existing knowledge.db while rendering a map", async () => {
    const { projectRoot, env, fakeHome } = await initProject("read-only-map-db");
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

    const result = runAmpStackMap({
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

  it("escapes status text in the rendered map", () => {
    const html = renderAmpStackMapHtml({
      ok: true,
      role: "scaffold-control-plane",
      mode: "read-only",
      primaryBackend: "gbrain",
      requestedKnowledgeBackend: "gbrain",
      evaluatedKnowledgeBackend: "gbrain",
      projectRoot: "<project>",
      readyCount: 0,
      needsActionCount: 1,
      blockedCount: 0,
      infoCount: 0,
      components: [
        {
          id: "gbrain",
          label: "GBrain <backend>",
          status: "needs_action",
          summary: "Install <gbrain>",
          nextAction: "Run `gbrain doctor` && inspect <output>",
        },
      ],
    });

    assert.match(html, /&lt;project&gt;/);
    assert.match(html, /GBrain &lt;backend&gt;/);
    assert.match(html, /Install &lt;gbrain&gt;/);
    assert.doesNotMatch(html, /<backend>/);
    assert.doesNotMatch(html, /<gbrain>/);
  });
});

describe("registerAmpCommands stack map", () => {
  it("registers amp stack map with output support", () => {
    const program = new Command().name("ai-memory");
    registerAmpCommands(program);

    const amp = program.commands.find((cmd) => cmd.name() === "amp");
    assert.ok(amp);

    const stack = amp.commands.find((cmd) => cmd.name() === "stack");
    assert.ok(stack, "expected amp stack command group");

    const map = stack.commands.find((cmd) => cmd.name() === "map");
    assert.ok(map, "expected amp stack map subcommand");
    assert.match(map.description(), /visual/i);
    assert.ok(
      map.options.some((option) => option.long === "--output"),
      "expected --output option on amp stack map",
    );
    assert.ok(
      map.options.some((option) => option.long === "--knowledge"),
      "expected --knowledge option on amp stack map",
    );
  });
});

describe("runAmpStackVerify", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-stack-verify-"));
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

  it("verifies the default local scaffold profile with warnings but no failures", async () => {
    const { projectRoot, env, fakeHome } = await initProject("local-profile");

    const result = runAmpStackVerify({
      projectRoot,
      env,
      homedir: () => fakeHome,
      gbrainSpawnFn: missingGbrainSpawn,
    });

    assert.equal(result.ok, true);
    assert.equal(result.profile, "local");
    assert.equal(result.primaryBackend, "gbrain");
    assert.equal(result.failCount, 0);
    assert.ok(result.warnCount > 0);
    assert.ok(result.checks.some((check) => check.id === "primary-backend" && check.status === "pass"));
    assert.ok(result.checks.some((check) => check.id === "gbrain-readiness" && check.status === "warn"));
  });

  it("fails the gbrain-live profile when gbrain is not ready", async () => {
    const { projectRoot, env, fakeHome } = await initProject("gbrain-live-missing");

    const result = runAmpStackVerify({
      projectRoot,
      env,
      homedir: () => fakeHome,
      profile: "gbrain-live",
      gbrainSpawnFn: missingGbrainSpawn,
    });

    assert.equal(result.ok, false);
    assert.equal(result.profile, "gbrain-live");
    assert.ok(result.failCount > 0);
    assert.ok(result.checks.some((check) => check.id === "gbrain-readiness" && check.status === "fail"));
  });

  it("passes gbrain-live readiness when gbrain probes pass", async () => {
    const { projectRoot, env, fakeHome } = await initProject("gbrain-live-ready");

    const result = runAmpStackVerify({
      projectRoot,
      env,
      homedir: () => fakeHome,
      profile: "gbrain-live",
      knowledge: "gbrain",
      gbrainSpawnFn: presentGbrainSpawn,
    });

    assert.equal(result.profile, "gbrain-live");
    assert.equal(result.primaryBackend, "gbrain");
    assert.equal(result.evaluatedKnowledgeBackend, "gbrain");
    assert.ok(result.checks.some((check) => check.id === "gbrain-readiness" && check.status === "pass"));
    assert.ok(result.checks.some((check) => check.id === "backend-selection" && check.status === "pass"));
  });

  it("fails gbrain-live readiness on unknown gbrain doctor warnings", async () => {
    const { projectRoot, env, fakeHome } = await initProject("gbrain-live-warning");

    const result = runAmpStackVerify({
      projectRoot,
      env,
      homedir: () => fakeHome,
      profile: "gbrain-live",
      knowledge: "gbrain",
      gbrainSpawnFn: warningGbrainSpawn,
    });

    assert.equal(result.ok, false);
    assert.ok(result.checks.some((check) => check.id === "gbrain-readiness" && check.status === "fail"));
  });

  it("fails closed for invalid backend selection", async () => {
    const { projectRoot, env, fakeHome } = await initProject("verify-invalid-backend");

    const result = runAmpStackVerify({
      projectRoot,
      env,
      homedir: () => fakeHome,
      knowledge: "postgres",
      gbrainSpawnFn: presentGbrainSpawn,
    });

    assert.equal(result.ok, false);
    assert.equal(result.evaluatedKnowledgeBackend, "invalid");
    assert.ok(result.checks.some((check) => check.id === "backend-selection" && check.status === "fail"));
  });

  it("formats verification reports and JSON", async () => {
    const { projectRoot, env, fakeHome } = await initProject("verify-format");
    const result = runAmpStackVerify({
      projectRoot,
      env,
      homedir: () => fakeHome,
      gbrainSpawnFn: missingGbrainSpawn,
    });

    const report = formatAmpStackVerifyReport(result).join("\n");
    assert.match(report, /AMP stack verify/);
    assert.match(report, /profile:\s+local/);
    assert.match(report, /primaryBackend:\s+gbrain/);

    const parsed = JSON.parse(formatAmpStackVerifyJson(result));
    assert.equal(parsed.profile, "local");
    assert.equal(parsed.primaryBackend, "gbrain");
    assert.ok(Array.isArray(parsed.checks));
    assert.equal(parsed.error, null);
  });

  it("does not open or migrate an existing knowledge.db while verifying", async () => {
    const { projectRoot, env, fakeHome } = await initProject("verify-read-only-db");
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

    const result = runAmpStackVerify({
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

describe("registerAmpCommands stack verify", () => {
  it("registers amp stack verify with profile and JSON support", () => {
    const program = new Command().name("ai-memory");
    registerAmpCommands(program);

    const amp = program.commands.find((cmd) => cmd.name() === "amp");
    assert.ok(amp);

    const stack = amp.commands.find((cmd) => cmd.name() === "stack");
    assert.ok(stack, "expected amp stack command group");

    const verify = stack.commands.find((cmd) => cmd.name() === "verify");
    assert.ok(verify, "expected amp stack verify subcommand");
    assert.match(verify.description(), /verification/i);
    assert.ok(
      verify.options.some((option) => option.long === "--profile"),
      "expected --profile option on amp stack verify",
    );
    assert.ok(
      verify.options.some((option) => option.long === "--json"),
      "expected --json option on amp stack verify",
    );
  });
});
