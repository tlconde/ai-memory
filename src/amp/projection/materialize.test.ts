import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_COMBINED_TOKEN_BUDGET,
  PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER,
  PROJECTION_FILE_KINDS,
  createProjectionDocument,
} from "./index.js";
import {
  DB_BACKED_MATERIALIZATION_NOT_WIRED,
  BUDGET_HARD_FAIL_BLOCKS_APPLY,
} from "./messages.js";
import { ProjectionSourceLoadError } from "./errors.js";
import {
  materializeProjections,
  planProjectionMaterialization,
} from "./materialize.js";
import { PlaceholderProjectionSource } from "./source.js";
import type { ProjectionSource } from "./source.js";

async function withTempDirs(
  run: (dirs: { fakeHome: string; projectRoot: string }) => Promise<void>
): Promise<void> {
  const fakeHome = await mkdtemp(join(tmpdir(), "amp-materialize-home-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "amp-materialize-project-"));
  try {
    await run({ fakeHome, projectRoot });
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

function applyCapableSource(
  documentsFactory: () => ReturnType<typeof createProjectionDocument>[]
): ProjectionSource {
  return {
    sourceKind: "test",
    supportsApply: true,
    loadProjectionDocuments: documentsFactory,
  };
}

describe("planProjectionMaterialization", () => {
  it("plans four dry-run writes using the placeholder source", async () => {
    await withTempDirs(async ({ fakeHome, projectRoot }) => {
      const source = new PlaceholderProjectionSource({ projectRef: "plan-app" });
      const plan = await planProjectionMaterialization(source, {
        projectRoot,
        mode: "dry-run",
        homedir: () => fakeHome,
      });

      assert.equal(plan.ok, true);
      assert.equal(plan.dryRun, true);
      assert.equal(plan.documents.length, 4);
      assert.equal(plan.writes.length, 4);
      assert.ok(plan.budget?.success);
      assert.equal(plan.projectRef, "plan-app");

      for (const write of plan.writes) {
        assert.equal(write.dryRun, true);
        assert.equal(write.wrote, false);
        assert.equal(existsSync(write.path), false);
      }

      assert.deepEqual(
        plan.writes.map((write) => write.kind),
        [...PROJECTION_FILE_KINDS]
      );
    });
  });

  it("reconciles combined_count across all documents", async () => {
    const source = applyCapableSource(() =>
      PROJECTION_FILE_KINDS.map((kind) =>
        createProjectionDocument({
          kind,
          token_count: 100,
          combined_count: 9999,
          status: "warning",
          ...(kind.startsWith("project_") ? { project_ref: "reconcile-app" } : {}),
        })
      )
    );

    const plan = await planProjectionMaterialization(source, {
      projectRoot: "/tmp/unused",
      mode: "dry-run",
    });

    assert.equal(plan.ok, true);
    assert.ok(plan.budget?.success);
    assert.equal(plan.budget.combined.combined_count, 400);
    assert.ok(
      plan.documents.every(
        (document) => document.metadata.budget.combined_count === 400
      )
    );
  });

  it("returns budget on hard fail without fake success", async () => {
    const hardCap = DEFAULT_COMBINED_TOKEN_BUDGET * PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER;
    const source = applyCapableSource(() => [
      createProjectionDocument({
        kind: "global_projection",
        token_count: hardCap + 1,
      }),
    ]);

    const plan = await planProjectionMaterialization(source, {
      projectRoot: "/tmp/unused",
      mode: "dry-run",
    });

    assert.equal(plan.ok, false);
    assert.ok(plan.budget);
    assert.equal(plan.budget.success, false);
    assert.match(plan.error ?? "", /hard cap/);
    assert.equal(plan.writes.length, 1);
    assert.equal(plan.writes[0]?.dryRun, true);
  });

  it("plans dry-run paths on hard fail without fake success budget", async () => {
    const hardCap = DEFAULT_COMBINED_TOKEN_BUDGET * PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER;
    const source = applyCapableSource(() => [
      createProjectionDocument({
        kind: "global_projection",
        token_count: hardCap + 1,
        combined_count: 0,
        status: "ok",
      }),
    ]);

    const plan = await planProjectionMaterialization(source, {
      projectRoot: "/tmp/unused",
      mode: "dry-run",
    });

    assert.equal(plan.ok, false);
    assert.ok(plan.budget);
    assert.equal(plan.budget.success, false);
    assert.equal(plan.writes.length, 1);
    assert.equal(plan.writes[0]?.dryRun, true);
  });
});

describe("materializeProjections", () => {
  it("dry-run never writes to disk with injected homedir", async () => {
    await withTempDirs(async ({ fakeHome, projectRoot }) => {
      const source = new PlaceholderProjectionSource();
      const result = await materializeProjections(source, {
        projectRoot,
        mode: "dry-run",
        homedir: () => fakeHome,
      });

      assert.equal(result.ok, true);
      assert.equal(result.dryRun, true);
      for (const write of result.writes) {
        assert.equal(existsSync(write.path), false);
      }
      assert.equal(existsSync(join(fakeHome, ".amp")), false);
    });
  });

  it("blocks apply for placeholder source before any disk write", async () => {
    await withTempDirs(async ({ fakeHome, projectRoot }) => {
      const source = new PlaceholderProjectionSource();
      const result = await materializeProjections(source, {
        projectRoot,
        mode: "apply",
        homedir: () => fakeHome,
      });

      assert.equal(result.ok, false);
      assert.equal(result.blocked, true);
      assert.equal(result.error, DB_BACKED_MATERIALIZATION_NOT_WIRED);
      assert.equal(result.budget, undefined);
      assert.deepEqual(result.writes, []);
      assert.equal(existsSync(join(fakeHome, ".amp")), false);
      assert.equal(
        result.error.includes("AMP-PROJ"),
        false,
        "user-facing message must not contain task IDs"
      );
    });
  });

  it("blocks apply on budget hard fail before writing", async () => {
    await withTempDirs(async ({ fakeHome, projectRoot }) => {
      const hardCap = DEFAULT_COMBINED_TOKEN_BUDGET * PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER;
      const source = applyCapableSource(() =>
        PROJECTION_FILE_KINDS.map((kind) =>
          createProjectionDocument({
            kind,
            token_count: Math.ceil((hardCap + 1) / PROJECTION_FILE_KINDS.length),
            ...(kind.startsWith("project_") ? { project_ref: "over-budget" } : {}),
          })
        )
      );

      const result = await materializeProjections(source, {
        projectRoot,
        mode: "apply",
        homedir: () => fakeHome,
      });

      assert.equal(result.ok, false);
      assert.equal(result.blocked, true);
      assert.equal(result.error, BUDGET_HARD_FAIL_BLOCKS_APPLY);
      assert.ok(result.budget);
      assert.equal(result.budget.success, false);
      assert.deepEqual(result.writes, []);
      assert.equal(existsSync(join(fakeHome, ".amp")), false);
    });
  });

  it("apply with supportsApply source writes all four files atomically", async () => {
    await withTempDirs(async ({ fakeHome, projectRoot }) => {
      const source = applyCapableSource(() =>
        PROJECTION_FILE_KINDS.map((kind) =>
          createProjectionDocument({
            kind,
            body: `# ${kind}\n\nApply materialization.\n`,
            ...(kind.startsWith("project_") ? { project_ref: "apply-app" } : {}),
          })
        )
      );

      const result = await materializeProjections(source, {
        projectRoot,
        mode: "apply",
        homedir: () => fakeHome,
      });

      assert.equal(result.ok, true);
      assert.equal(result.dryRun, false);
      assert.equal(result.writes.length, 4);
      assert.ok(result.budget?.success);

      for (const write of result.writes) {
        assert.equal(write.dryRun, false);
        assert.equal(write.wrote, true);
        assert.ok(existsSync(write.path));
        const content = await readFile(write.path, "utf8");
        assert.match(content, /Apply materialization/);
      }

      assert.deepEqual(
        result.writes.map((write) => write.path),
        [
          join(fakeHome, ".amp", "projection", "global.md"),
          join(fakeHome, ".amp", "runtime", "global.md"),
          join(projectRoot, ".amp", "local", "projection.md"),
          join(projectRoot, ".amp", "local", "runtime.md"),
        ]
      );
    });
  });

  it("distinguishes blocked apply from successful dry-run without fake budget", async () => {
    const blocked = await materializeProjections(new PlaceholderProjectionSource(), {
      projectRoot: "/tmp/unused",
      mode: "apply",
    });
    const planned = await materializeProjections(new PlaceholderProjectionSource(), {
      projectRoot: "/tmp/unused",
      mode: "dry-run",
    });

    assert.equal(blocked.budget, undefined);
    assert.equal(blocked.ok, false);
    assert.ok(planned.budget?.success);
    assert.equal(planned.ok, true);
  });

  it("returns structured failure when source throws ProjectionSourceLoadError", async () => {
    const source: ProjectionSource = {
      sourceKind: "test",
      supportsApply: true,
      loadProjectionDocuments: async () => {
        throw new ProjectionSourceLoadError("Gbrain projection read failed: simulated outage");
      },
    };

    const result = await materializeProjections(source, {
      projectRoot: "/tmp/unused",
      mode: "dry-run",
    });

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /simulated outage/);
    assert.deepEqual(result.writes, []);
    assert.equal(result.documents.length, 0);
  });

  it("loads pending upstream changesets under AMP_USER_ROOT without real homedir", async () => {
    const ampUserRoot = await mkdtemp(join(tmpdir(), "amp-materialize-user-root-"));
    const projectRoot = await mkdtemp(join(tmpdir(), "amp-materialize-project-root-"));
    const rejectRealHomedir = (): string => {
      throw new Error("must not resolve real homedir during projection materialize");
    };

    try {
      const source = new PlaceholderProjectionSource({ projectRef: "isolated-upstream" });
      const env = { AMP_USER_ROOT: ampUserRoot };

      const plan = await planProjectionMaterialization(source, {
        projectRoot,
        mode: "dry-run",
        env,
        homedir: rejectRealHomedir,
      });

      assert.equal(plan.ok, true);
      assert.equal(
        plan.writes.find((write) => write.kind === "global_projection")?.path,
        join(ampUserRoot, "projection", "global.md")
      );
      assert.equal(existsSync(join(ampUserRoot, "upstream", "changesets")), false);
    } finally {
      await rm(ampUserRoot, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
