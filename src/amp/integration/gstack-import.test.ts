/**
 * Gstack import falsifiable tests (AMP §9.9.5).
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runAmpProceduralImportGstack } from "../cli/procedural.js";
import { runAmpProceduralRevokeGstack } from "../cli/procedural.js";
import { runAmpProceduralList } from "../cli/procedural.js";
import { applyChangeset } from "../upstream/apply.js";
import { runUpstreamSync } from "../upstream/sync.js";
import { AMP_USER_UPSTREAM_PATH_ENV } from "../config/paths.js";
import {
  applyGstackLocalEditPromotion,
  countOnDiskFromAmpArtifacts,
  countPropagatedHarnessArtifacts,
  createGstackUpstreamSource,
  harnessSnapshotsEqual,
  snapshotHarnessFromAmp,
} from "../upstream/gstack-import.js";
import { createPropagationHarnessWriters } from "../cli/propagate.js";
import {
  createV1FixtureProject,
  destroyV1FixtureProject,
  type V1FixtureProject,
} from "./fixtures/v1-project.js";
import { ProcedureRegistry } from "../procedural/registry.js";
import { mkdir } from "node:fs/promises";

const GSTACK_MINI_FIXTURE = fileURLToPath(new URL("./fixtures/gstack-mini", import.meta.url));

const envStack: Array<{
  fixture: V1FixtureProject;
  registry: ProcedureRegistry;
  harnessSnapshot: Map<string, Buffer>;
}> = [];

afterEach(async () => {
  while (envStack.length > 0) {
    const env = envStack.pop();
    if (env) {
      await destroyV1FixtureProject(env.fixture);
    }
  }
});

async function createGstackImportEnv(name: string): Promise<{
  fixture: V1FixtureProject;
  registry: ProcedureRegistry;
  harnessSnapshot: Map<string, Buffer>;
  ref: string;
  env: NodeJS.ProcessEnv;
}> {
  const fixture = await createV1FixtureProject({ projectRef: `gstack-${name}` });
  const harnessSnapshot = await snapshotHarnessFromAmp(fixture.root);
  const registry = new ProcedureRegistry();
  const ref = "gstack-mini-fixture-ref";
  const upstreamDir = join(fixture.root, ".amp-user-upstream");
  await mkdir(upstreamDir, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [AMP_USER_UPSTREAM_PATH_ENV]: upstreamDir,
  };

  envStack.push({ fixture, registry, harnessSnapshot });
  return { fixture, registry, harnessSnapshot, ref, env };
}

describe("AMP gstack import §9.9.5", () => {
  it("imports valid skills, surfaces validation_error for invalid skill, and propagates by harness", async () => {
    const env = await createGstackImportEnv("import-counts");
    const beforeSnapshot = structuredClone(env.harnessSnapshot);

    const imported = await runAmpProceduralImportGstack({
      checkoutPath: GSTACK_MINI_FIXTURE,
      ref: env.ref,
      projectRoot: env.fixture.root,
      registry: env.registry,
    });

    assert.equal(imported.ok, true);
    assert.deepEqual(imported.imported.sort(), [
      "claude-compound",
      "cursor-search",
      "portable-helper",
    ]);
    assert.equal(imported.validationErrors.length, 1);
    assert.equal(imported.validationErrors[0]?.skillName, "broken-skill");
    assert.ok(imported.validationErrors[0]?.validation_error);

    const expectedCounts = countPropagatedHarnessArtifacts({
      harnessRoots: env.fixture.harnessRoots,
      registry: env.registry,
    });
    const onDiskCounts = await countOnDiskFromAmpArtifacts(env.fixture.harnessRoots);

    assert.equal(onDiskCounts.cursor, expectedCounts.cursor);
    assert.equal(onDiskCounts["claude-code"], expectedCounts["claude-code"]);
    assert.equal(onDiskCounts.hermes, expectedCounts.hermes);
    assert.ok(onDiskCounts.cursor >= 2);
    assert.ok(onDiskCounts["claude-code"] >= 2);
    assert.ok(onDiskCounts.hermes >= 1);

    const list = await runAmpProceduralList({
      projectRoot: env.fixture.root,
      registry: env.registry,
    });
    assert.equal(list.entries.length, 3);
    assert.ok(!list.entries.some((entry) => entry.validation_error));

    assert.notEqual(
      harnessSnapshotsEqual(beforeSnapshot, await snapshotHarnessFromAmp(env.fixture.root)),
      true
    );
  });

  it("revoke gstack restores harness from-amp paths byte-for-byte", async () => {
    const env = await createGstackImportEnv("revoke-restore");
    const beforeSnapshot = await snapshotHarnessFromAmp(env.fixture.root);

    await runAmpProceduralImportGstack({
      checkoutPath: GSTACK_MINI_FIXTURE,
      ref: env.ref,
      projectRoot: env.fixture.root,
      registry: env.registry,
    });

    const revoked = await runAmpProceduralRevokeGstack({
      projectRoot: env.fixture.root,
      registry: env.registry,
      harnessSnapshot: beforeSnapshot,
    });

    assert.equal(revoked.ok, true);
    assert.equal(revoked.removed.length, 3);

    const afterSnapshot = await snapshotHarnessFromAmp(env.fixture.root);
    assert.equal(harnessSnapshotsEqual(beforeSnapshot, afterSnapshot), true);
    assert.equal(env.registry.list().length, 0);
  });

  it("GstackUpstreamSource detects upstream edits via runUpstreamSync", async () => {
    const env = await createGstackImportEnv("upstream-sync");
    const imported = await runAmpProceduralImportGstack({
      checkoutPath: GSTACK_MINI_FIXTURE,
      ref: env.ref,
      projectRoot: env.fixture.root,
      registry: env.registry,
    });
    assert.equal(imported.ok, true);

    const source = createGstackUpstreamSource({
      checkoutDir: GSTACK_MINI_FIXTURE,
      ref: env.ref,
      registry: env.registry,
      localRef: env.ref,
    });

    const skillPath = join(GSTACK_MINI_FIXTURE, "skills", "portable-helper", "SKILL.md");
    const original = await readFile(skillPath, "utf8");
    await writeFile(skillPath, `${original}\n<!-- upstream edit -->\n`, "utf8");

    try {
      const sync = await runUpstreamSync({
        projectRoot: env.fixture.root,
        env: env.env,
        sources: [source],
        registry: env.registry,
        detectedAt: new Date("2026-05-29T10:00:00.000Z"),
      });
      assert.equal(sync[0]?.driftDetected, true);
      assert.ok(sync[0]?.changesetId);
    } finally {
      await writeFile(skillPath, original, "utf8");
    }
  });

  it("versioning: untouched imports stay 0.x; local edit promotes to 1.x; upstream re-edit conflicts", async () => {
    const env = await createGstackImportEnv("version-conflict");
    const imported = await runAmpProceduralImportGstack({
      checkoutPath: GSTACK_MINI_FIXTURE,
      ref: env.ref,
      projectRoot: env.fixture.root,
      registry: env.registry,
    });
    assert.equal(imported.ok, true);

    const untouched = env.registry.get("portable-helper");
    assert.ok(untouched?.procedure.frontmatter.version.startsWith("0."));

    const baseSyncedAt = "2026-05-29T10:00:00.000Z";
    const seeded = env.registry.get("portable-helper");
    assert.ok(seeded);
    env.registry.update("portable-helper", {
      ...seeded.procedure,
      frontmatter: {
        ...seeded.procedure.frontmatter,
        provenance: {
          ...seeded.procedure.frontmatter.provenance!,
          created_at: baseSyncedAt,
          upstream: {
            ...seeded.procedure.frontmatter.provenance!.upstream!,
            ref: env.ref,
            fetched_at: baseSyncedAt,
            upstream_synced_at: baseSyncedAt,
          },
        },
      },
    });

    const editedAt = "2026-05-29T12:00:00.000Z";
    applyGstackLocalEditPromotion(
      env.registry,
      "portable-helper",
      "# Portable helper\n\nLocally edited body.\n",
      editedAt
    );

    const edited = env.registry.get("portable-helper");
    assert.ok(edited?.procedure.frontmatter.version.startsWith("1."));
    assert.equal(edited?.procedure.frontmatter.provenance?.updated_at, editedAt);

    const skillPath = join(GSTACK_MINI_FIXTURE, "skills", "portable-helper", "SKILL.md");
    const original = await readFile(skillPath, "utf8");
    const upstreamEditedAt = new Date("2026-05-29T14:00:00.000Z");
    await writeFile(skillPath, `${original}\n<!-- upstream edit after local promotion -->\n`, "utf8");
    await utimes(skillPath, upstreamEditedAt, upstreamEditedAt);

    try {
      const source = createGstackUpstreamSource({
        checkoutDir: GSTACK_MINI_FIXTURE,
        ref: `${env.ref}-edited`,
        registry: env.registry,
        localRef: env.ref,
      });

      const sync = await runUpstreamSync({
        projectRoot: env.fixture.root,
        env: env.env,
        sources: [source],
        registry: env.registry,
        detectedAt: new Date("2026-05-29T13:00:00.000Z"),
      });
      assert.equal(sync[0]?.driftDetected, true);

      const changesetId = sync[0]?.changesetId;
      assert.ok(changesetId);

      const entry = env.registry.get("portable-helper");
      assert.ok(entry?.conflicts.some((conflict) => conflict.reason === "concurrent_edit"));

      const refused = await applyChangeset({
        changesetId,
        projectRoot: env.fixture.root,
        env: env.env,
        registry: env.registry,
        source,
        writers: createPropagationHarnessWriters(env.fixture.root),
      });
      assert.equal(refused.ok, false);
      assert.match(refused.error ?? "", /--accept-upstream/);
    } finally {
      await writeFile(skillPath, original, "utf8");
    }
  });

  it("revoke via persisted snapshot restores harness byte-for-byte", async () => {
    const env = await createGstackImportEnv("revoke-persisted");
    const beforeSnapshot = await snapshotHarnessFromAmp(env.fixture.root);

    await runAmpProceduralImportGstack({
      checkoutPath: GSTACK_MINI_FIXTURE,
      ref: env.ref,
      projectRoot: env.fixture.root,
      registry: env.registry,
    });

    const revoked = await runAmpProceduralRevokeGstack({
      projectRoot: env.fixture.root,
      registry: env.registry,
    });

    assert.equal(revoked.ok, true);
    const afterSnapshot = await snapshotHarnessFromAmp(env.fixture.root);
    assert.equal(harnessSnapshotsEqual(beforeSnapshot, afterSnapshot), true);
  });

  it("lists checkout candidates with validation_error before import", async () => {
    const list = await runAmpProceduralList({
      checkoutPath: GSTACK_MINI_FIXTURE,
      ref: "preview-ref",
    });

    assert.equal(list.entries.length, 4);
    const broken = list.entries.find((entry) => entry.name === "broken-skill");
    assert.ok(broken?.validation_error);
  });
});

describe("gstack importer local-only guard", () => {
  it("has no network or git-clone calls in importer modules", async () => {
    const { execFileSync } = await import("node:child_process");
    const pattern = "https?://|\\bgit clone\\b|globalThis\\.fetch|from ['\"]node-fetch";
    const files = [
      "src/amp/procedural/parse-skill-md.ts",
      "src/amp/upstream/gstack-source.ts",
      "src/amp/upstream/gstack-import.ts",
      "src/amp/cli/procedural.ts",
    ];

    for (const file of files) {
      let output = "";
      try {
        output = execFileSync("rg", ["-n", pattern, file], { encoding: "utf8" }).trim();
      } catch {
        output = "";
      }
      assert.equal(output, "", `Unexpected network pattern in ${file}:\n${output}`);
    }
  });
});
