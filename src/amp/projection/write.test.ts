import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PROJECTION_FILE_KINDS } from "./constants.js";
import { parseProjectionMarkdown } from "./render.js";
import { createProjectionDocument } from "./schema.js";
import { writeProjectionFile, writeProjectionFiles } from "./write.js";

async function withTempDirs(
  run: (dirs: { fakeHome: string; projectRoot: string }) => Promise<void>
): Promise<void> {
  const fakeHome = await mkdtemp(join(tmpdir(), "amp-projection-home-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "amp-projection-project-"));
  try {
    await run({ fakeHome, projectRoot });
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

describe("writeProjectionFile", () => {
  it("writes global projections under injected homedir only", async () => {
    await withTempDirs(async ({ fakeHome }) => {
      const document = createProjectionDocument({
        kind: "global_projection",
        body: "# Global projection\n\nKnowledge summary.\n",
      });

      const result = await writeProjectionFile(document, {
        homedir: () => fakeHome,
      });

      assert.equal(result.kind, "global_projection");
      assert.equal(result.path, join(fakeHome, ".amp", "projection", "global.md"));
      assert.equal(result.dryRun, false);
      assert.equal(result.wrote, true);
      assert.ok(result.bytes > 0);
      assert.ok(existsSync(result.path));

      const written = await readFile(result.path, "utf8");
      assert.equal(Buffer.byteLength(written, "utf8"), result.bytes);
      const parsed = parseProjectionMarkdown(written);
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.deepEqual(parsed.document, document);
      }
    });
  });

  it("writes project projections under projectRoot/.amp/local", async () => {
    await withTempDirs(async ({ fakeHome, projectRoot }) => {
      const document = createProjectionDocument({
        kind: "project_runtime",
        project_ref: "demo-app",
        body: "# Project runtime\n\nIn-flight work.\n",
      });

      const result = await writeProjectionFile(document, {
        homedir: () => fakeHome,
        projectRoot,
      });

      assert.equal(result.kind, "project_runtime");
      assert.equal(result.path, join(projectRoot, ".amp", "local", "runtime.md"));
      assert.ok(existsSync(result.path));
      assert.ok(result.path.startsWith(projectRoot));
      assert.doesNotMatch(result.path, /CLAUDE\.md$|from-amp|SKILL\.md|\.mdc$/);
    });
  });

  it("creates parent directories recursively", async () => {
    await withTempDirs(async ({ fakeHome }) => {
      const parentDir = join(fakeHome, ".amp", "runtime");
      assert.equal(existsSync(parentDir), false);

      await writeProjectionFile(createProjectionDocument({ kind: "global_runtime" }), {
        homedir: () => fakeHome,
      });

      assert.ok(existsSync(parentDir));
      assert.ok(existsSync(join(parentDir, "global.md")));
    });
  });

  it("requires projectRoot for project-scoped kinds", async () => {
    await withTempDirs(async ({ fakeHome }) => {
      await assert.rejects(
        () =>
          writeProjectionFile(createProjectionDocument({ kind: "project_projection" }), {
            homedir: () => fakeHome,
          }),
        /projectRoot is required for project_projection writes/
      );
    });
  });

  it("dryRun returns planned writes without touching disk", async () => {
    await withTempDirs(async ({ fakeHome, projectRoot }) => {
      const document = createProjectionDocument({
        kind: "global_projection",
        body: "# Dry run\n\nNo disk writes.\n",
      });

      const result = await writeProjectionFile(document, {
        homedir: () => fakeHome,
        projectRoot,
        dryRun: true,
      });

      assert.equal(result.dryRun, true);
      assert.equal(result.wrote, false);
      assert.equal(result.path, join(fakeHome, ".amp", "projection", "global.md"));
      assert.ok(result.bytes > 0);
      assert.equal(existsSync(result.path), false);
    });
  });

  it("respects AMP_USER_ROOT env override for global paths", async () => {
    await withTempDirs(async ({ fakeHome }) => {
      const ampRoot = join(fakeHome, "custom-amp-root");
      const document = createProjectionDocument({ kind: "global_runtime" });

      const result = await writeProjectionFile(document, {
        homedir: () => "/should-not-be-used",
        env: { AMP_USER_ROOT: ampRoot },
      });

      assert.equal(result.path, join(ampRoot, "runtime", "global.md"));
      assert.ok(existsSync(result.path));
    });
  });
});

describe("writeProjectionFiles", () => {
  it("writes all four canonical projection paths", async () => {
    await withTempDirs(async ({ fakeHome, projectRoot }) => {
      const documents = PROJECTION_FILE_KINDS.map((kind) =>
        createProjectionDocument({
          kind,
          body: `# ${kind}\n\nBatch write.\n`,
          ...(kind.startsWith("project_") ? { project_ref: "batch-app" } : {}),
        })
      );

      const results = await writeProjectionFiles(documents, {
        homedir: () => fakeHome,
        projectRoot,
      });

      assert.equal(results.length, 4);
      assert.deepEqual(
        results.map((result) => result.kind),
        [...PROJECTION_FILE_KINDS]
      );
      assert.deepEqual(
        results.map((result) => result.path),
        [
          join(fakeHome, ".amp", "projection", "global.md"),
          join(fakeHome, ".amp", "runtime", "global.md"),
          join(projectRoot, ".amp", "local", "projection.md"),
          join(projectRoot, ".amp", "local", "runtime.md"),
        ]
      );
      for (const result of results) {
        assert.equal(result.wrote, true);
        assert.equal(result.dryRun, false);
        assert.ok(existsSync(result.path));
      }
    });
  });

  it("dryRun plans batch writes without creating files", async () => {
    await withTempDirs(async ({ fakeHome, projectRoot }) => {
      const documents = PROJECTION_FILE_KINDS.map((kind) =>
        createProjectionDocument({
          kind,
          ...(kind.startsWith("project_") ? { project_ref: "dry-batch" } : {}),
        })
      );

      const results = await writeProjectionFiles(documents, {
        homedir: () => fakeHome,
        projectRoot,
        dryRun: true,
      });

      assert.equal(results.length, 4);
      for (const result of results) {
        assert.equal(result.dryRun, true);
        assert.equal(result.wrote, false);
        assert.equal(existsSync(result.path), false);
      }
    });
  });

  it("rejects duplicate kinds in one batch", async () => {
    await withTempDirs(async ({ fakeHome }) => {
      await assert.rejects(
        () =>
          writeProjectionFiles(
            [
              createProjectionDocument({ kind: "global_projection" }),
              createProjectionDocument({ kind: "global_projection" }),
            ],
            { homedir: () => fakeHome }
          ),
        /duplicate projection write for kind global_projection/
      );
    });
  });
});
