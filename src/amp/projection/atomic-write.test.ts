import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { PROJECTION_FILE_KINDS } from "./constants.js";
import { parseProjectionMarkdown } from "./render.js";
import { createProjectionDocument } from "./schema.js";
import { writeProjectionFile } from "./write.js";
import { writeProjectionFileAtomic, writeProjectionFilesAtomic } from "./atomic-write.js";

async function withTempDirs(
  run: (dirs: { fakeHome: string; projectRoot: string }) => Promise<void>
): Promise<void> {
  const fakeHome = await mkdtemp(join(tmpdir(), "amp-projection-atomic-home-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "amp-projection-atomic-project-"));
  try {
    await run({ fakeHome, projectRoot });
  } finally {
    await rm(fakeHome, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
}

function tempFilesInDir(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdir(dir).then((names) => names.filter((name) => name.includes(".tmp")));
}

describe("writeProjectionFileAtomic", () => {
  it("writes projection content atomically to canonical paths", async () => {
    await withTempDirs(async ({ fakeHome }) => {
      const document = createProjectionDocument({
        kind: "global_projection",
        body: "# Global projection\n\nAtomic write.\n",
      });

      const result = await writeProjectionFileAtomic(document, {
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

      const parentDir = join(fakeHome, ".amp", "projection");
      assert.deepEqual(await tempFilesInDir(parentDir), []);
    });
  });

  it("overwrites an existing projection file", async () => {
    await withTempDirs(async ({ fakeHome }) => {
      const path = join(fakeHome, ".amp", "runtime", "global.md");
      const first = createProjectionDocument({
        kind: "global_runtime",
        body: "# First\n\nOriginal content.\n",
      });
      const second = createProjectionDocument({
        kind: "global_runtime",
        body: "# Second\n\nReplaced content.\n",
      });

      await writeProjectionFileAtomic(first, { homedir: () => fakeHome });
      await writeProjectionFileAtomic(second, { homedir: () => fakeHome });

      const written = await readFile(path, "utf8");
      assert.match(written, /Replaced content/);
      assert.doesNotMatch(written, /Original content/);
    });
  });

  it("cleans up temp files when rename fails", async () => {
    await withTempDirs(async ({ fakeHome }) => {
      const targetPath = join(fakeHome, ".amp", "projection", "global.md");
      const parentDir = dirname(targetPath);
      await mkdir(parentDir, { recursive: true });
      await mkdir(targetPath);

      const document = createProjectionDocument({
        kind: "global_projection",
        body: "# Blocked\n\nRename should fail.\n",
      });

      await assert.rejects(
        () => writeProjectionFileAtomic(document, { homedir: () => fakeHome }),
        /EISDIR|EEXIST|ENOTDIR|EPERM/
      );

      assert.deepEqual(await tempFilesInDir(parentDir), []);
    });
  });

  it("cleans up temp files when parent mkdir fails", async () => {
    await withTempDirs(async ({ fakeHome }) => {
      const blockedHome = join(fakeHome, "blocked-home");
      await writeFile(blockedHome, "not-a-directory", "utf8");

      const document = createProjectionDocument({
        kind: "global_projection",
        body: "# Blocked\n\nParent mkdir should fail.\n",
      });

      await assert.rejects(
        () => writeProjectionFileAtomic(document, { homedir: () => blockedHome }),
        /ENOTDIR|EEXIST|EPERM/
      );

      assert.equal(existsSync(join(blockedHome, ".amp")), false);
    });
  });

  it("dryRun plans atomic writes without touching disk", async () => {
    await withTempDirs(async ({ fakeHome, projectRoot }) => {
      const document = createProjectionDocument({
        kind: "global_projection",
        body: "# Dry run\n\nNo disk writes.\n",
      });

      const result = await writeProjectionFileAtomic(document, {
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

  it("matches non-atomic dryRun behavior from writeProjectionFile", async () => {
    await withTempDirs(async ({ fakeHome, projectRoot }) => {
      const document = createProjectionDocument({
        kind: "project_runtime",
        project_ref: "parity-app",
        body: "# Parity\n\nDry run parity.\n",
      });
      const options = {
        homedir: () => fakeHome,
        projectRoot,
        dryRun: true as const,
      };

      const atomicResult = await writeProjectionFileAtomic(document, options);
      const plainResult = await writeProjectionFile(document, options);

      assert.deepEqual(atomicResult, plainResult);
    });
  });

  it("requires projectRoot for project-scoped kinds", async () => {
    await withTempDirs(async ({ fakeHome }) => {
      await assert.rejects(
        () =>
          writeProjectionFileAtomic(createProjectionDocument({ kind: "project_projection" }), {
            homedir: () => fakeHome,
          }),
        /projectRoot is required for project_projection writes/
      );
    });
  });
});

describe("writeProjectionFilesAtomic", () => {
  it("writes all four canonical projection paths", async () => {
    await withTempDirs(async ({ fakeHome, projectRoot }) => {
      const documents = PROJECTION_FILE_KINDS.map((kind) =>
        createProjectionDocument({
          kind,
          body: `# ${kind}\n\nAtomic batch write.\n`,
          ...(kind.startsWith("project_") ? { project_ref: "batch-app" } : {}),
        })
      );

      const results = await writeProjectionFilesAtomic(documents, {
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

      const results = await writeProjectionFilesAtomic(documents, {
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
          writeProjectionFilesAtomic(
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
