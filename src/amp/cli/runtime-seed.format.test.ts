import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";

import { registerAmpCommands } from "./index.js";
import {
  formatAmpRuntimeSeedJson,
  formatAmpRuntimeSeedReport,
  runAmpRuntimeSeed,
} from "./runtime-seed.js";
import {
  ACTIVE_PREFERENCE,
  createRuntimeSeedTestHarness,
  type RuntimeSeedTestHarness,
} from "./runtime-seed.test-fixture.js";

describe("runAmpRuntimeSeed formatting", () => {
  let harness: RuntimeSeedTestHarness;

  before(async () => {
    harness = await createRuntimeSeedTestHarness("amp-runtime-seed-format-");
  });

  after(async () => {
    await harness.cleanup();
  });

  it("returns parseable JSON with --json formatting helper", async () => {
    const { projectRoot, env, fakeHome } = await harness.initProject("json-seed");
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
