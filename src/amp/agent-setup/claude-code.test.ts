import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CLAUDE_PROJECT_FILENAME,
  PROJECTION_MATERIALIZATION_REQUIRED,
  runClaudeCodeProjectSetup,
} from "./claude-code.js";
import { buildMarkerBlock } from "./markers.js";
import { PROJECT_LOCAL_DIR } from "../projection/paths.js";

describe("Claude Code project setup", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-claude-setup-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("dry-run does not write CLAUDE.md", async () => {
    const projectRoot = join(tempRoot, "dry-run");
    await mkdir(join(projectRoot, PROJECT_LOCAL_DIR), { recursive: true });

    const result = await runClaudeCodeProjectSetup({ projectRoot, mode: "dry-run" });
    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(existsSync(join(projectRoot, CLAUDE_PROJECT_FILENAME)), false);
  });

  it("apply creates CLAUDE.md with AMP marker imports", async () => {
    const projectRoot = join(tempRoot, "apply-create");
    await mkdir(join(projectRoot, PROJECT_LOCAL_DIR), { recursive: true });

    const result = await runClaudeCodeProjectSetup({ projectRoot, mode: "apply" });
    assert.equal(result.ok, true);
    const content = await readFile(join(projectRoot, CLAUDE_PROJECT_FILENAME), "utf8");
    assert.match(content, /@\.amp\/local\/projection\.md/);
    assert.match(content, /@\.amp\/local\/runtime\.md/);
  });

  it("apply preserves user-authored content outside the marker block", async () => {
    const projectRoot = join(tempRoot, "preserve-user");
    await mkdir(join(projectRoot, PROJECT_LOCAL_DIR), { recursive: true });
    const claudePath = join(projectRoot, CLAUDE_PROJECT_FILENAME);
    await writeFile(claudePath, "# Team guidance\n\nKeep this line.\n", "utf8");

    await runClaudeCodeProjectSetup({ projectRoot, mode: "apply" });
    const content = await readFile(claudePath, "utf8");
    assert.match(content, /# Team guidance/);
    assert.match(content, /Keep this line\./);
    assert.match(content, /@\.amp\/local\/projection\.md/);
  });

  it("apply replaces only the AMP marker block on re-run", async () => {
    const projectRoot = join(tempRoot, "replace-block");
    await mkdir(join(projectRoot, PROJECT_LOCAL_DIR), { recursive: true });
    const claudePath = join(projectRoot, CLAUDE_PROJECT_FILENAME);
    await writeFile(
      claudePath,
      ["# Header", "", buildMarkerBlock(["@legacy/path.md"]), "", "Footer"].join("\n"),
      "utf8"
    );

    await runClaudeCodeProjectSetup({ projectRoot, mode: "apply" });
    const content = await readFile(claudePath, "utf8");
    assert.match(content, /# Header/);
    assert.match(content, /Footer/);
    assert.doesNotMatch(content, /@legacy\/path\.md/);
    assert.match(content, /@\.amp\/local\/runtime\.md/);
  });

  it("errors on apply when .amp/local/ is missing", async () => {
    const projectRoot = join(tempRoot, "missing-local-dir");

    const result = await runClaudeCodeProjectSetup({ projectRoot, mode: "apply" });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), new RegExp(PROJECTION_MATERIALIZATION_REQUIRED));
  });

  it("clears missing-file warning when projection files exist", async () => {
    const projectRoot = join(tempRoot, "files-present");
    const localDir = join(projectRoot, PROJECT_LOCAL_DIR);
    await mkdir(localDir, { recursive: true });
    await writeFile(join(localDir, "projection.md"), "# Projection\n", "utf8");
    await writeFile(join(localDir, "runtime.md"), "# Runtime\n", "utf8");

    const result = await runClaudeCodeProjectSetup({ projectRoot, mode: "dry-run" });
    assert.equal(result.ok, true);
    assert.equal(result.warnings.length, 0);
  });
});
