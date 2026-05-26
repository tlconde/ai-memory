import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { AMP_KNOWLEDGE_BACKEND_ENV } from "./knowledge-backend.js";
import { createProjectionRenderSource } from "./projection-source.js";
import { openRuntimeStore, resolveCliProjectContext } from "./cli-context.js";
import { runAmpRuntimeSeed } from "./runtime-seed.js";
import {
  ACTIVE_PREFERENCE,
  createRuntimeSeedTestHarness,
  type RuntimeSeedTestHarness,
} from "./runtime-seed.test-fixture.js";

describe("runAmpRuntimeSeed execution", () => {
  let harness: RuntimeSeedTestHarness;

  before(async () => {
    harness = await createRuntimeSeedTestHarness("amp-runtime-seed-execution-");
  });

  after(async () => {
    await harness.cleanup();
  });

  it("writes a valid file and default local projection renders the entity", async () => {
    const { projectRoot, env, fakeHome } = await harness.initProject("valid-seed");
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

  it("persists valid records and reports invalid records in a mixed array", async () => {
    const { projectRoot, env, fakeHome } = await harness.initProject("mixed-seed");
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
    const { projectRoot, env, fakeHome } = await harness.initProject("duplicate-seed");
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
});
