import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const COPY_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "copy-amp-specs.mjs");
const DIST_ROOT = join(REPO_ROOT, "dist");

function listYamlFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".yaml"))
    .sort();
}

describe("copy-amp-specs build step", () => {
  it("copies all ssa-files and sas-files yaml specs into dist", () => {
    if (!existsSync(DIST_ROOT)) {
      mkdirSync(DIST_ROOT, { recursive: true });
    }

    execFileSync(process.execPath, [COPY_SCRIPT], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });

    for (const dir of ["ssa-files", "sas-files"]) {
      const sourceDir = join(REPO_ROOT, dir);
      const destDir = join(DIST_ROOT, dir);
      const expected = listYamlFiles(sourceDir);

      assert.equal(existsSync(destDir), true, `expected ${destDir}`);
      assert.deepEqual(listYamlFiles(destDir), expected);

      for (const name of expected) {
        assert.equal(existsSync(join(destDir, name)), true, `expected ${join(destDir, name)}`);
      }
    }

    assert.equal(existsSync(join(DIST_ROOT, "ssa-files", "gbrain.yaml")), true);
    assert.equal(existsSync(join(DIST_ROOT, "sas-files", "hermes.yaml")), true);
  });
});
