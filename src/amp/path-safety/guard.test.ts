import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertWritePathAllowed, joinInsideRoot, PathSafetyError } from "./guard.js";

describe("from-amp path safety", () => {
  let tempDir = "";
  let fromAmpRoot = "";

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "amp-path-safety-"));
    fromAmpRoot = join(tempDir, "harness-rules", "from-amp");
    await mkdir(fromAmpRoot, { recursive: true });
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("allows writes inside from-amp root", () => {
    const target = joinInsideRoot(fromAmpRoot, "PREFERENCE.mdc");
    assert.ok(target.endsWith("PREFERENCE.mdc"));
  });

  it("rejects parent escape via ..", () => {
    assert.throws(
      () => assertWritePathAllowed(join(fromAmpRoot, "..", "outside.mdc"), { allowedRoot: fromAmpRoot }),
      PathSafetyError
    );
  });

  it("rejects symlink escape when target resolves outside root", async () => {
    const outsideDir = join(tempDir, "outside");
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, "evil.mdc"), "# evil");
    const linkPath = join(fromAmpRoot, "link.mdc");
    await symlink(join(outsideDir, "evil.mdc"), linkPath);

    assert.throws(
      () => assertWritePathAllowed(linkPath, { allowedRoot: fromAmpRoot }),
      PathSafetyError
    );
  });

  it("rejects symlink directory escape for non-existent target file", async () => {
    const outsideDir = join(tempDir, "outside-dir");
    await mkdir(outsideDir, { recursive: true });
    const linkDir = join(fromAmpRoot, "link-dir");
    await symlink(outsideDir, linkDir);

    assert.throws(
      () => assertWritePathAllowed(join(linkDir, "new.mdc"), { allowedRoot: fromAmpRoot }),
      PathSafetyError
    );
  });

  it("rejects direct write to from-amp root", () => {
    assert.throws(
      () => assertWritePathAllowed(fromAmpRoot, { allowedRoot: fromAmpRoot }),
      PathSafetyError
    );
  });

  it("rejects writes when an ancestor of allowedRoot is a symlink escape", async () => {
    const projectDir = join(tempDir, "project");
    const outsideCursor = join(tempDir, "outside-cursor");
    await mkdir(projectDir, { recursive: true });
    await mkdir(outsideCursor, { recursive: true });
    await symlink(outsideCursor, join(projectDir, ".cursor"));

    const root = join(projectDir, ".cursor", "rules", "from-amp");
    const target = join(root, "new.mdc");

    assert.throws(
      () => assertWritePathAllowed(target, { allowedRoot: root }),
      PathSafetyError
    );
  });
});
