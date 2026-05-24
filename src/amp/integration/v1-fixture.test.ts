import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";

import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import {
  createV1FixtureProject,
  destroyV1FixtureProject,
  discoverFixtureAmpConfig,
  fixtureUsesLocalGbrain,
  type V1FixtureProject,
} from "./fixtures/v1-project.js";

describe("v1 fixture project scaffolding", () => {
  let fixture: V1FixtureProject;

  before(async () => {
    fixture = await createV1FixtureProject({ knowledgeMode: "in-memory" });
  });

  after(async () => {
    await destroyV1FixtureProject(fixture);
  });

  it("creates project config and harness from-amp roots", async () => {
    await access(fixture.projectConfigPath);
    await access(fixture.harnessRoots.cursorFromAmp);
    await access(fixture.harnessRoots.claudeCodeFromAmp);
    await access(fixture.harnessRoots.hermesFromAmp);
  });

  it("resolves isolated runtime path via AMP config discovery", () => {
    const config = discoverFixtureAmpConfig(fixture);
    assert.equal(config.runtime.dbPath, fixture.runtimeDbPath);
    assert.equal(config.sources.runtimePathSource, "project");
    assert.equal(config.projectRef, "amp-v1-fixture");
  });

  it("wires in-memory knowledge mode without claiming gbrain E2E", () => {
    assert.equal(fixture.knowledgeMode, "in-memory");
    assert.equal(fixtureUsesLocalGbrain(fixture), false);

    const runtime = new RuntimeStore({ dbPath: fixture.runtimeDbPath });
    const knowledge = new InMemoryKnowledgeStore();
    runtime.set("fixture_probe", true);
    assert.equal(runtime.get("fixture_probe"), true);
    assert.equal(knowledge.capabilities().vector_search, "unsupported");
    runtime.close();
  });

  it("marks local-gbrain mode as scaffolding-only (no live assertion)", async () => {
    const gbrainFixture = await createV1FixtureProject({ knowledgeMode: "local-gbrain" });
    try {
      assert.equal(fixtureUsesLocalGbrain(gbrainFixture), true);
      assert.equal(gbrainFixture.knowledgeMode, "local-gbrain");
    } finally {
      await destroyV1FixtureProject(gbrainFixture);
    }
  });
});
