/**
 * Gbrain skills discovery falsifiable tests (AMP §10.4.2).
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { AMP_USER_UPSTREAM_PATH_ENV } from "../config/paths.js";
import { runAmpProceduralList } from "../cli/procedural.js";
import { runAmpUpstreamSubscribe } from "../cli/upstream.js";
import {
  GBRAIN_SKILLS_DIR_ENV,
  GBRAIN_SKILLS_SUBSCRIPTION_ID,
  gbrainSkillsDirResolutionErrorMessage,
} from "../upstream/gbrain-skills-source.js";
import { ProcedureRegistry } from "../procedural/registry.js";
import {
  createV1FixtureProject,
  destroyV1FixtureProject,
  type V1FixtureProject,
} from "./fixtures/v1-project.js";
import { countOnDiskFromAmpArtifacts } from "../upstream/gstack-import.js";

const GBRAIN_SKILLS_MINI = fileURLToPath(
  new URL("./fixtures/gbrain-skills-mini", import.meta.url)
);

const envStack: Array<{
  fixture?: V1FixtureProject;
  upstreamDir?: string;
}> = [];

afterEach(async () => {
  while (envStack.length > 0) {
    const env = envStack.pop();
    if (env?.fixture) {
      await destroyV1FixtureProject(env.fixture);
    }
    if (env?.upstreamDir) {
      await rm(env.upstreamDir, { recursive: true, force: true });
    }
  }
});

async function isolatedUpstreamEnv(): Promise<{
  upstreamDir: string;
  env: NodeJS.ProcessEnv;
}> {
  const upstreamDir = await mkdtemp(join(tmpdir(), "amp-gbrain-upstream-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [AMP_USER_UPSTREAM_PATH_ENV]: upstreamDir,
    [GBRAIN_SKILLS_DIR_ENV]: "",
  };
  delete env[GBRAIN_SKILLS_DIR_ENV];
  envStack.push({ upstreamDir });
  return { upstreamDir, env };
}

describe("AMP gbrain skills discovery §10.4.2", () => {
  it("lists valid skills with parsed frontmatter via --source gbrain --path", async () => {
    const list = await runAmpProceduralList({
      source: "gbrain",
      skillsPath: GBRAIN_SKILLS_MINI,
      ref: "gbrain-mini-fixture",
    });

    assert.equal(list.entries.length, 3);
    const valid = list.entries.filter((entry) => !entry.validation_error);
    assert.deepEqual(
      valid.map((entry) => entry.name).sort(),
      ["gbrain-helper", "portable-gbrain-skill"]
    );
    for (const entry of valid) {
      assert.ok(entry.frontmatter);
      assert.equal(entry.frontmatter?.name, entry.name);
      assert.ok(entry.supported_harnesses.length >= 1);
    }

    const broken = list.entries.find((entry) => entry.name === "broken-gbrain-skill");
    assert.ok(broken?.validation_error);
    assert.equal(broken?.frontmatter, undefined);
  });

  it("lists skills from gbrain-skills subscription without --path or env", async () => {
    const { upstreamDir, env } = await isolatedUpstreamEnv();
    await mkdir(upstreamDir, { recursive: true });

    await runAmpUpstreamSubscribe({
      url: `stub:${GBRAIN_SKILLS_MINI}`,
      id: GBRAIN_SKILLS_SUBSCRIPTION_ID,
      env,
      upstreamDir,
    });

    const list = await runAmpProceduralList({
      source: "gbrain",
      env,
      upstreamDir,
      ref: "subscription-fixture",
    });

    assert.equal(list.entries.length, 3);
    const valid = list.entries.filter((entry) => !entry.validation_error);
    assert.deepEqual(
      valid.map((entry) => entry.name).sort(),
      ["gbrain-helper", "portable-gbrain-skill"]
    );
  });

  it("fails closed when flag, env, and subscription are all missing", async () => {
    const { upstreamDir, env } = await isolatedUpstreamEnv();
    await mkdir(join(upstreamDir, "upstream"), { recursive: true });

    await assert.rejects(
      () =>
        runAmpProceduralList({
          source: "gbrain",
          env,
          upstreamDir,
        }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        const expected = gbrainSkillsDirResolutionErrorMessage();
        assert.match(message, /--path/);
        assert.match(message, new RegExp(GBRAIN_SKILLS_DIR_ENV));
        assert.match(message, /amp upstream subscribe/);
        assert.match(message, new RegExp(GBRAIN_SKILLS_SUBSCRIPTION_ID));
        assert.equal(message, expected);
        return true;
      }
    );
  });

  it("does not mutate registry or harness from-amp dirs", async () => {
    const fixture = await createV1FixtureProject({ projectRef: "gbrain-discovery-readonly" });
    envStack.push({ fixture });

    const registry = new ProcedureRegistry();
    const beforeRegistryCount = registry.list().length;
    const beforeHarnessCounts = await countOnDiskFromAmpArtifacts(fixture.harnessRoots);

    await runAmpProceduralList({
      source: "gbrain",
      skillsPath: GBRAIN_SKILLS_MINI,
      projectRoot: fixture.root,
      registry,
    });

    assert.equal(registry.list().length, beforeRegistryCount);
    const afterHarnessCounts = await countOnDiskFromAmpArtifacts(fixture.harnessRoots);
    assert.deepEqual(afterHarnessCounts, beforeHarnessCounts);

    const skillsEntries = await readdir(GBRAIN_SKILLS_MINI);
    assert.ok(skillsEntries.includes("gbrain-helper"));
    assert.ok(skillsEntries.includes("broken-gbrain-skill"));
  });
});

describe("gbrain skills discovery local-only guard", () => {
  it("has no network calls in gbrain-skills-source.ts", async () => {
    const { execFileSync } = await import("node:child_process");
    const pattern = "http|https|fetch\\(";
    const file = "src/amp/upstream/gbrain-skills-source.ts";
    let output = "";
    try {
      output = execFileSync("rg", ["-n", pattern, file], { encoding: "utf8" }).trim();
    } catch {
      output = "";
    }
    assert.equal(output, "", `Unexpected network pattern in ${file}:\n${output}`);
  });
});
