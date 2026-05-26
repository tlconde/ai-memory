import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { AMP_KNOWLEDGE_BACKEND_ENV } from "./knowledge-backend.js";
import { createProjectionRenderSource } from "./projection-source.js";
import { registerAmpCommands } from "./index.js";
import { runAmpInit } from "./init.js";
import { openRuntimeStore, resolveCliProjectContext } from "./cli-context.js";
import {
  formatAmpRuntimeSeedJson,
  formatAmpRuntimeSeedReport,
  runAmpRuntimeSeed,
} from "./runtime-seed.js";

const ISO = "2026-05-26T12:00:00.000Z";

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

describe("runAmpRuntimeSeed", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-runtime-seed-cli-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function initProject(name: string) {
    const projectRoot = join(tempRoot, name);
    const fakeHome = join(tempRoot, `home-${name}`);
    const env = { HOME: fakeHome, AMP_KNOWLEDGE_BACKEND: "in-memory" };
    await runAmpInit({ projectRoot, env });
    return { projectRoot, env, fakeHome };
  }

  it("writes a valid file and default local projection renders the entity", async () => {
    const { projectRoot, env, fakeHome } = await initProject("valid-seed");
    const context = resolveCliProjectContext({ projectRoot, env, homedir: () => fakeHome });
    const seedPath = join(projectRoot, "seed.json");
    await writeFile(
      seedPath,
      JSON.stringify({
        id: "pref-1",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: ACTIVE_PREFERENCE,
      }),
      "utf8",
    );

    const result = await runAmpRuntimeSeed({
      projectRoot,
      file: seedPath,
      env,
      homedir: () => fakeHome,
    });

    assert.equal(result.ok, true);
    assert.equal(result.results.length, 1);
    assert.deepEqual(result.results[0], { id: "pref-1", ok: true });

    const runtime = openRuntimeStore(context.runtimeDbPath);
    try {
      assert.equal(runtime.semanticEntityList().length, 1);
      assert.equal(runtime.semanticEntityList()[0]?.id, "pref-1");

      const resolved = createProjectionRenderSource({
        sourceKind: "local",
        projectRef: "valid-seed",
        runtimeDbPath: context.runtimeDbPath,
        knowledgeStore: new InMemoryKnowledgeStore(),
        env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "in-memory" },
        deps: { openRuntimeStore: () => runtime },
      });

      assert.ok(!("error" in resolved));
      const documents = resolved.source.loadProjectionDocuments({ projectRef: "valid-seed" });
      const globalRuntime = documents.find((doc) => doc.metadata.kind === "global_runtime");
      assert.match(globalRuntime?.body ?? "", /Keep responses short today/);
    } finally {
      runtime.close();
    }
  });

  it("reports validation failure for invalid records and does not write", async () => {
    const { projectRoot, env, fakeHome } = await initProject("invalid-seed");
    const context = resolveCliProjectContext({ projectRoot, env, homedir: () => fakeHome });
    const seedPath = join(projectRoot, "invalid-seed.json");
    await writeFile(
      seedPath,
      JSON.stringify({
        id: "dec-bad",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: "invalid-seed",
        payload: { id: "dec-bad" },
      }),
      "utf8",
    );

    const result = await runAmpRuntimeSeed({
      projectRoot,
      file: seedPath,
      env,
      homedir: () => fakeHome,
    });

    assert.equal(result.ok, false);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.ok, false);
    if (result.results[0]?.ok === false) {
      assert.equal(result.results[0].reason, "invalid_input");
    }

    const runtime = openRuntimeStore(context.runtimeDbPath);
    try {
      assert.deepEqual(runtime.semanticEntityList(), []);
    } finally {
      runtime.close();
    }
  });

  it("persists valid records and reports invalid records in a mixed array", async () => {
    const { projectRoot, env, fakeHome } = await initProject("mixed-seed");
    const context = resolveCliProjectContext({ projectRoot, env, homedir: () => fakeHome });
    const seedPath = join(projectRoot, "mixed-seed.json");
    await writeFile(
      seedPath,
      JSON.stringify([
        {
          id: "pref-a",
          kind: "runtime-preference-candidate",
          scope: "user",
          payload: { ...ACTIVE_PREFERENCE, id: "pref-a", statement: "First preference" },
        },
        {
          id: "dec-bad",
          kind: "unresolved-decision",
          scope: "project",
          project_ref: "mixed-seed",
          payload: { id: "dec-bad" },
        },
      ]),
      "utf8",
    );

    const result = await runAmpRuntimeSeed({
      projectRoot,
      file: seedPath,
      env,
      homedir: () => fakeHome,
    });

    assert.equal(result.ok, false);
    assert.deepEqual(
      result.results.map((entry) => ({ id: entry.id, ok: entry.ok })),
      [
        { id: "pref-a", ok: true },
        { id: "dec-bad", ok: false },
      ],
    );

    const runtime = openRuntimeStore(context.runtimeDbPath);
    try {
      assert.deepEqual(
        runtime.semanticEntityList().map((row) => row.id),
        ["pref-a"],
      );
    } finally {
      runtime.close();
    }
  });

  it("reports duplicate_id for duplicate IDs", async () => {
    const { projectRoot, env, fakeHome } = await initProject("duplicate-seed");
    const seedPath = join(projectRoot, "duplicate-seed.json");
    await writeFile(
      seedPath,
      JSON.stringify([
        {
          id: "pref-dup",
          kind: "runtime-preference-candidate",
          scope: "user",
          payload: { ...ACTIVE_PREFERENCE, id: "pref-dup", statement: "First" },
        },
        {
          id: "pref-dup",
          kind: "runtime-preference-candidate",
          scope: "user",
          payload: { ...ACTIVE_PREFERENCE, id: "pref-dup", statement: "Duplicate" },
        },
      ]),
      "utf8",
    );

    const result = await runAmpRuntimeSeed({
      projectRoot,
      file: seedPath,
      env,
      homedir: () => fakeHome,
    });

    assert.equal(result.ok, false);
    assert.equal(result.results[0]?.ok, true);
    assert.equal(result.results[1]?.ok, false);
    if (result.results[1]?.ok === false) {
      assert.equal(result.results[1].reason, "duplicate_id");
    }
  });

  it("returns parseable JSON with --json formatting helper", async () => {
    const { projectRoot, env, fakeHome } = await initProject("json-seed");
    const seedPath = join(projectRoot, "json-seed.json");
    await writeFile(
      seedPath,
      JSON.stringify({
        id: "pref-json",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: { ...ACTIVE_PREFERENCE, id: "pref-json" },
      }),
      "utf8",
    );

    const result = await runAmpRuntimeSeed({
      projectRoot,
      file: seedPath,
      env,
      homedir: () => fakeHome,
    });

    const payload = JSON.parse(formatAmpRuntimeSeedJson(result)) as {
      ok: boolean;
      file: string;
      results: Array<{ id: string; ok: boolean; reason?: string; message?: string }>;
    };

    assert.equal(payload.ok, true);
    assert.equal(payload.file, seedPath);
    assert.deepEqual(payload.results, [{ id: "pref-json", ok: true }]);

    const text = formatAmpRuntimeSeedReport(result).join("\n");
    assert.match(text, /experimental operator command/);
    assert.match(text, /OK pref-json/);
  });
});

describe("registerAmpCommands runtime seed", () => {
  it("registers runtime seed subcommand with file and json options", () => {
    const program = new Command().name("ai-memory");
    registerAmpCommands(program);

    const amp = program.commands.find((cmd) => cmd.name() === "amp");
    assert.ok(amp);

    const runtime = amp.commands.find((cmd) => cmd.name() === "runtime");
    assert.ok(runtime);

    const seed = runtime.commands.find((cmd) => cmd.name() === "seed");
    assert.ok(seed, "expected amp runtime seed subcommand");
    assert.match(seed.description() ?? "", /experimental/i);
    assert.ok(
      seed.options.some((option) => option.long?.includes("--file")),
      "expected --file option on runtime seed",
    );
    assert.ok(
      seed.options.some((option) => option.long?.includes("--json")),
      "expected --json option on runtime seed",
    );
    assert.ok(
      seed.options.some((option) => option.long?.includes("--project-root")),
      "expected --project-root option on runtime seed",
    );
  });
});
