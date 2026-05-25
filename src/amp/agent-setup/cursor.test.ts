import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CURSOR_FROM_AMP_REL } from "../adapters/sas/cursor/adapter.js";
import { PathSafetyError } from "../path-safety/guard.js";
import { PROJECT_LOCAL_DIR } from "../projection/paths.js";
import {
  CURSOR_PROJECTION_RULE_FILENAME,
  buildCursorProjectionMdc,
  resolveCursorSetupWritePath,
  runCursorProjectSetup,
} from "./cursor.js";

describe("Cursor projection rule setup", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-cursor-setup-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function seedProjectionFiles(projectRoot: string): Promise<void> {
    const localDir = join(projectRoot, PROJECT_LOCAL_DIR);
    await mkdir(localDir, { recursive: true });
    await writeFile(join(localDir, "projection.md"), "# Projection body\nPrefer tests.\n", "utf8");
    await writeFile(join(localDir, "runtime.md"), "# Runtime body\nQueued note.\n", "utf8");
  }

  it("dry-run does not write the mdc file", async () => {
    const projectRoot = join(tempRoot, "dry-run");
    await seedProjectionFiles(projectRoot);

    const result = await runCursorProjectSetup({ projectRoot, mode: "dry-run" });
    assert.equal(result.ok, true);
    assert.equal(
      existsSync(join(projectRoot, CURSOR_FROM_AMP_REL, CURSOR_PROJECTION_RULE_FILENAME)),
      false
    );
  });

  it("apply writes only under from-amp", async () => {
    const projectRoot = join(tempRoot, "apply");
    await seedProjectionFiles(projectRoot);

    const result = await runCursorProjectSetup({ projectRoot, mode: "apply" });
    assert.equal(result.ok, true);
    const rulePath = join(projectRoot, CURSOR_FROM_AMP_REL, CURSOR_PROJECTION_RULE_FILENAME);
    assert.equal(existsSync(rulePath), true);
    assert.equal(existsSync(join(projectRoot, ".cursor", "rules", "other.mdc")), false);
  });

  it("rejects path escape through from-amp helper", () => {
    const projectRoot = join(tempRoot, "path-escape");
    assert.throws(
      () => resolveCursorSetupWritePath(projectRoot, "../outside.mdc"),
      PathSafetyError
    );
  });

  it("errors on apply when projection files are missing", async () => {
    const projectRoot = join(tempRoot, "missing-files");
    await mkdir(projectRoot, { recursive: true });

    const result = await runCursorProjectSetup({ projectRoot, mode: "apply" });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /projection render --source local --apply/);
  });

  it("emits flattened projection and runtime content without recursive @ imports", async () => {
    const projectRoot = join(tempRoot, "flattened");
    await seedProjectionFiles(projectRoot);

    await runCursorProjectSetup({ projectRoot, mode: "apply" });
    const content = await readFile(
      join(projectRoot, CURSOR_FROM_AMP_REL, CURSOR_PROJECTION_RULE_FILENAME),
      "utf8"
    );
    assert.match(content, /alwaysApply: true/);
    assert.match(content, /## AMP Project Projection/);
    assert.match(content, /Prefer tests\./);
    assert.match(content, /## AMP Project Runtime/);
    assert.match(content, /Queued note\./);
    assert.doesNotMatch(content, /@\.amp\/local\//);
    assert.doesNotMatch(content, /^@/m);
  });

  it("buildCursorProjectionMdc produces deterministic frontmatter", () => {
    const content = buildCursorProjectionMdc("proj", "run");
    assert.match(content, /^---\ndescription: "AMP project projection and runtime context"/);
    assert.match(content, /alwaysApply: true/);
  });
});
