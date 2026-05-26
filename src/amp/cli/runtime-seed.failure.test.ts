import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { openRuntimeStore, resolveCliProjectContext } from "./cli-context.js";
import { runAmpRuntimeSeed } from "./runtime-seed.js";
import {
  ACTIVE_PREFERENCE,
  createRuntimeSeedTestHarness,
  type RuntimeSeedTestHarness,
} from "./runtime-seed.test-fixture.js";

describe("runAmpRuntimeSeed failure handling", () => {
  let harness: RuntimeSeedTestHarness;

  before(async () => {
    harness = await createRuntimeSeedTestHarness("amp-runtime-seed-failure-");
  });

  after(async () => {
    await harness.cleanup();
  });

  it("reports invalid_record_shape for malformed envelope records via the seed CLI path", async () => {
    const { projectRoot, env, fakeHome } = await harness.initProject("invalid-shape-seed");
    const context = resolveCliProjectContext({ projectRoot, env, homedir: () => fakeHome });
    const seedPath = join(projectRoot, "invalid-shape-seed.json");
    await writeFile(
      seedPath,
      JSON.stringify([
        {
          kind: "runtime-preference-candidate",
          scope: "user",
          payload: ACTIVE_PREFERENCE,
        },
        "not-an-object",
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
    assert.equal(result.results.length, 2);
    assert.equal(result.results[0]?.ok, false);
    assert.equal(result.results[1]?.ok, false);
    if (result.results[0]?.ok === false) {
      assert.equal(result.results[0].reason, "invalid_record_shape");
      assert.equal(result.results[0].id, "record[0]");
      assert.match(result.results[0].message, /id must be a non-empty string/i);
    }
    if (result.results[1]?.ok === false) {
      assert.equal(result.results[1].reason, "invalid_record_shape");
      assert.equal(result.results[1].id, "record[1]");
      assert.match(result.results[1].message, /non-null object/i);
    }

    const runtime = openRuntimeStore(context.runtimeDbPath);
    try {
      assert.deepEqual(runtime.semanticEntityList(), []);
    } finally {
      runtime.close();
    }
  });

  it("reports validation failure for invalid records and does not write", async () => {
    const { projectRoot, env, fakeHome } = await harness.initProject("invalid-seed");
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
});
