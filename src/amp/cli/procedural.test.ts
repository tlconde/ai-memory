import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runAmpProceduralList } from "./procedural.js";

describe("runAmpProceduralList gbrain --path", () => {
  it("fails closed when explicit --path points at a missing directory", async () => {
    const missingPath = join(tmpdir(), "amp-gbrain-missing-skills-dir-never-created");

    await assert.rejects(
      () =>
        runAmpProceduralList({
          source: "gbrain",
          skillsPath: missingPath,
        }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.equal(message, `Gbrain skills path ${missingPath} does not exist`);
        return true;
      }
    );
  });

  it("returns an empty list when explicit --path points at an empty directory", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "amp-gbrain-empty-skills-"));
    try {
      const list = await runAmpProceduralList({
        source: "gbrain",
        skillsPath: emptyDir,
      });
      assert.deepEqual(list.entries, []);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});
