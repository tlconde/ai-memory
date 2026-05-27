import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import type { Frame } from "../core/frame-schema.js";
import { runAmpInit } from "./init.js";
import { registerAmpCommands } from "./index.js";
import {
  formatAmpKnowledgeStatusJson,
  formatAmpKnowledgeStatusReport,
  runAmpKnowledgeStatus,
} from "./knowledge-status.js";
import { runAmpRuntimeSeed } from "./runtime-seed.js";
import {
  runAmpRuntimeGraduationApply,
} from "./runtime-graduation-apply.js";

const ISO = "2026-05-27T10:00:00.000Z";

const ACTIVE_PREFERENCE = {
  id: "pref-1",
  statement: "Keep responses short today",
  mode: "time_bounded" as const,
  scope: "user" as const,
  context: {},
  status: "active" as const,
  expires_at: ISO,
  first_observed_at: ISO,
  last_observed_at: ISO,
  source_signal_ids: ["signal-3"],
  confidence: "medium" as const,
  promotion_evidence: {
    repetition_count: 0,
    independent_sessions: 0,
  },
};

describe("runAmpKnowledgeStatus", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-knowledge-status-"));
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

  it("returns error when project AMP config is missing", async () => {
    const projectRoot = join(tempRoot, "missing-config");
    const result = runAmpKnowledgeStatus({ projectRoot });

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /Project AMP config not found/);
    assert.equal(result.totalFrames, 0);
  });

  it("reports empty knowledge DB after init (DB does not yet exist)", async () => {
    const { projectRoot, env, fakeHome } = await initProject("empty-db");
    const result = runAmpKnowledgeStatus({
      projectRoot,
      env,
      homedir: () => fakeHome,
    });

    assert.equal(result.ok, true);
    assert.equal(result.knowledgeDbExists, false);
    assert.equal(result.totalFrames, 0);
    assert.deepEqual(result.countsByKind, {});
    assert.deepEqual(result.countsByScope, {});
    assert.match(result.knowledgeDbPath, /knowledge\.db$/);
    assert.match(result.runtimeDbPath, /runtime\.db$/);
  });

  it("counts one frame written by graduation apply", async () => {
    const { projectRoot, env, fakeHome } = await initProject("one-frame");

    const seedPath = join(projectRoot, "seed.json");
    await writeFile(
      seedPath,
      JSON.stringify({
        id: "pref-confirmed",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: {
          ...ACTIVE_PREFERENCE,
          id: "pref-confirmed",
          promotion_evidence: {
            ...ACTIVE_PREFERENCE.promotion_evidence,
            explicit_confirmation_signal_id: "confirm-1",
          },
        },
      }),
      "utf8",
    );

    const seedResult = await runAmpRuntimeSeed({
      projectRoot,
      file: seedPath,
      env,
      homedir: () => fakeHome,
    });
    assert.equal(seedResult.ok, true);

    const applyResult = runAmpRuntimeGraduationApply({
      projectRoot,
      id: "pref-confirmed",
      env,
      homedir: () => fakeHome,
    });
    assert.equal(applyResult.ok, true);

    const statusResult = runAmpKnowledgeStatus({
      projectRoot,
      env,
      homedir: () => fakeHome,
    });

    assert.equal(statusResult.ok, true);
    assert.equal(statusResult.knowledgeDbExists, true);
    assert.equal(statusResult.totalFrames, 1);
    assert.equal(statusResult.countsByKind["semantic"], 1);
    assert.equal(statusResult.countsByScope["user"], 1);
  });

  it("JSON output is parseable and includes paths and counts", async () => {
    const { projectRoot, env, fakeHome } = await initProject("json-output");

    const result = runAmpKnowledgeStatus({
      projectRoot,
      env,
      homedir: () => fakeHome,
    });

    const json = formatAmpKnowledgeStatusJson(result);
    const parsed = JSON.parse(json);

    assert.equal(parsed.ok, true);
    assert.equal(typeof parsed.projectRoot, "string");
    assert.equal(typeof parsed.runtimeDbPath, "string");
    assert.equal(typeof parsed.knowledgeDbPath, "string");
    assert.equal(typeof parsed.knowledgeDbExists, "boolean");
    assert.equal(typeof parsed.totalFrames, "number");
    assert.equal(typeof parsed.countsByKind, "object");
    assert.equal(typeof parsed.countsByScope, "object");
    assert.equal(parsed.error, null);
  });

  it("uses injected knowledge store without opening SQLite", async () => {
    const { projectRoot, env, fakeHome } = await initProject("injected-store");
    const store = new InMemoryKnowledgeStore();
    const frame: Frame = {
      id: "frame-injected",
      kind: "episodic",
      schema_version: "1.0",
      content: "test preference",
      curation_mode: "personal",
      scope: { kind: "project", project_ref: "test-proj" },
      source: { surface: "cli" },
      created_at: ISO,
    };
    store.write([frame]);

    const result = runAmpKnowledgeStatus({
      projectRoot,
      env,
      homedir: () => fakeHome,
      knowledgeStore: store,
    });

    assert.equal(result.ok, true);
    assert.equal(result.totalFrames, 1);
    assert.equal(result.countsByKind["episodic"], 1);
    assert.equal(result.countsByScope["project"], 1);
  });

  it("ignores AMP_KNOWLEDGE_BACKEND=gbrain and still reads local SQLite", async () => {
    const { projectRoot, env, fakeHome } = await initProject("ignore-gbrain-env");
    const overrideEnv = { ...env, AMP_KNOWLEDGE_BACKEND: "gbrain" };

    const result = runAmpKnowledgeStatus({
      projectRoot,
      env: overrideEnv,
      homedir: () => fakeHome,
    });

    assert.equal(result.ok, true);
    assert.equal(result.knowledgeDbExists, false);
    assert.equal(result.totalFrames, 0);
  });

  it("human-readable format includes key fields", async () => {
    const { projectRoot, env, fakeHome } = await initProject("human-format");

    const result = runAmpKnowledgeStatus({
      projectRoot,
      env,
      homedir: () => fakeHome,
    });

    const lines = formatAmpKnowledgeStatusReport(result);
    const output = lines.join("\n");

    assert.match(output, /AMP knowledge status/);
    assert.match(output, /knowledgeDbPath/);
    assert.match(output, /runtimeDbPath/);
    assert.match(output, /totalFrames/);
    assert.match(output, /OK/);
  });

  it("error format includes ERROR marker", () => {
    const result = runAmpKnowledgeStatus({
      projectRoot: join(tempRoot, "nonexistent-project"),
    });

    const lines = formatAmpKnowledgeStatusReport(result);
    const output = lines.join("\n");

    assert.match(output, /ERROR/);
    assert.match(output, /Knowledge status could not be determined/);
  });
});

describe("amp knowledge status command registration", () => {
  it("registers knowledge status under amp command group", () => {
    const program = new Command();
    registerAmpCommands(program);

    const amp = program.commands.find((c) => c.name() === "amp");
    assert.ok(amp, "amp command group should be registered");

    const knowledge = amp!.commands.find((c) => c.name() === "knowledge");
    assert.ok(knowledge, "knowledge subcommand should be registered");

    const status = knowledge!.commands.find((c) => c.name() === "status");
    assert.ok(status, "status subcommand should be registered under knowledge");
  });

  it("help text mentions read-only and no gbrain", () => {
    const program = new Command();
    registerAmpCommands(program);

    const amp = program.commands.find((c) => c.name() === "amp")!;
    const knowledge = amp.commands.find((c) => c.name() === "knowledge")!;
    const status = knowledge.commands.find((c) => c.name() === "status")!;

    const desc = status.description();
    assert.match(desc, /read-only/);
    assert.match(desc, /no gbrain/);
  });
});
