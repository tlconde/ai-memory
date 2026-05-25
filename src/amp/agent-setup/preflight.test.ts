import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PROJECT_LOCAL_DIR } from "../projection/paths.js";
import {
  PROJECTION_FILES_MISSING_WARNING,
  PROJECTION_MATERIALIZATION_REQUIRED,
  checkProjectProjectionPreflight,
} from "./preflight.js";

describe("checkProjectProjectionPreflight", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-agent-preflight-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("allows Claude apply when local dir exists but files are missing", async () => {
    const projectRoot = join(tempRoot, "claude-dir-only");
    await mkdir(join(projectRoot, PROJECT_LOCAL_DIR), { recursive: true });

    const result = checkProjectProjectionPreflight({
      projectRoot,
      mode: "apply",
      requireFiles: false,
    });

    assert.equal(result.ok, true);
    assert.match(result.warnings.join("\n"), new RegExp(PROJECTION_FILES_MISSING_WARNING));
    assert.equal(result.errors.length, 0);
  });

  it("errors on Claude apply when local dir is missing", () => {
    const projectRoot = join(tempRoot, "claude-no-dir");

    const result = checkProjectProjectionPreflight({
      projectRoot,
      mode: "apply",
      requireFiles: false,
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), new RegExp(PROJECTION_MATERIALIZATION_REQUIRED));
  });

  it("requires projection files for Cursor apply", async () => {
    const projectRoot = join(tempRoot, "cursor-apply-missing");
    await mkdir(join(projectRoot, PROJECT_LOCAL_DIR), { recursive: true });

    const result = checkProjectProjectionPreflight({
      projectRoot,
      mode: "apply",
      requireFiles: true,
    });

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), new RegExp(PROJECTION_MATERIALIZATION_REQUIRED));
  });

  it("warns on Cursor dry-run when files are missing", async () => {
    const projectRoot = join(tempRoot, "cursor-dry-run-missing");
    await mkdir(join(projectRoot, PROJECT_LOCAL_DIR), { recursive: true });

    const result = checkProjectProjectionPreflight({
      projectRoot,
      mode: "dry-run",
      requireFiles: true,
    });

    assert.equal(result.ok, true);
    assert.match(result.warnings.join("\n"), new RegExp(PROJECTION_MATERIALIZATION_REQUIRED));
  });

  it("passes when both projection files exist", async () => {
    const projectRoot = join(tempRoot, "files-present");
    const localDir = join(projectRoot, PROJECT_LOCAL_DIR);
    await mkdir(localDir, { recursive: true });
    await writeFile(join(localDir, "projection.md"), "# Projection\n", "utf8");
    await writeFile(join(localDir, "runtime.md"), "# Runtime\n", "utf8");

    const result = checkProjectProjectionPreflight({
      projectRoot,
      mode: "apply",
      requireFiles: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.warnings.length, 0);
    assert.equal(result.errors.length, 0);
  });
});
