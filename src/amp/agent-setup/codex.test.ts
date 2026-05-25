import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CODEX_PROJECT_FILENAME,
  PROJECTION_MATERIALIZATION_REQUIRED,
  runCodexProjectSetup,
} from "./codex.js";
import {
  CODEX_MARKER,
  MarkerBlockError,
  buildMarkerBlockFor,
  upsertMarkerBlockFor,
} from "./markers.js";
import { PROJECT_LOCAL_DIR } from "../projection/paths.js";

describe("Codex project setup", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-codex-setup-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function seedLocalFiles(projectRoot: string): Promise<void> {
    const localDir = join(projectRoot, PROJECT_LOCAL_DIR);
    await mkdir(localDir, { recursive: true });
    await writeFile(join(localDir, "projection.md"), "# Projection\n", "utf8");
    await writeFile(
      join(localDir, "runtime.md"),
      "# Runtime\n\nAMP_SENTINEL_CODEX_CONTEXT_20260525\n",
      "utf8"
    );
  }

  it("dry-run does not write AGENTS.md", async () => {
    const projectRoot = join(tempRoot, "dry-run");
    await seedLocalFiles(projectRoot);

    const result = await runCodexProjectSetup({ projectRoot, mode: "dry-run" });
    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(existsSync(join(projectRoot, CODEX_PROJECT_FILENAME)), false);
  });

  it("apply creates AGENTS.md with inlined projection and runtime sections", async () => {
    const projectRoot = join(tempRoot, "apply-create");
    await seedLocalFiles(projectRoot);

    const result = await runCodexProjectSetup({ projectRoot, mode: "apply" });
    assert.equal(result.ok, true);
    const content = await readFile(join(projectRoot, CODEX_PROJECT_FILENAME), "utf8");
    assert.match(content, /## AMP Project Projection/);
    assert.match(content, /## AMP Project Runtime/);
    assert.match(content, /AMP_SENTINEL_CODEX_CONTEXT_20260525/);
    assert.match(content, new RegExp(CODEX_MARKER.begin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("apply preserves user-authored content outside the marker block", async () => {
    const projectRoot = join(tempRoot, "preserve-user");
    await seedLocalFiles(projectRoot);
    const agentsPath = join(projectRoot, CODEX_PROJECT_FILENAME);
    await writeFile(agentsPath, "# Team guidance\n\nKeep this line.\n", "utf8");

    await runCodexProjectSetup({ projectRoot, mode: "apply" });
    const content = await readFile(agentsPath, "utf8");
    assert.match(content, /# Team guidance/);
    assert.match(content, /Keep this line\./);
    assert.match(content, /## AMP Project Runtime/);
  });

  it("apply replaces only the AMP marker block on re-run", async () => {
    const projectRoot = join(tempRoot, "replace-block");
    await seedLocalFiles(projectRoot);
    const agentsPath = join(projectRoot, CODEX_PROJECT_FILENAME);
    await writeFile(
      agentsPath,
      [
        "# Header",
        "",
        buildMarkerBlockFor(["## Legacy", "old content"], CODEX_MARKER),
        "",
        "Footer",
      ].join("\n"),
      "utf8"
    );

    await runCodexProjectSetup({ projectRoot, mode: "apply" });
    const content = await readFile(agentsPath, "utf8");
    assert.match(content, /# Header/);
    assert.match(content, /Footer/);
    assert.doesNotMatch(content, /old content/);
    assert.match(content, /AMP_SENTINEL_CODEX_CONTEXT_20260525/);
  });

  it("is idempotent when projection files are unchanged", async () => {
    const projectRoot = join(tempRoot, "idempotent");
    await seedLocalFiles(projectRoot);

    const first = await runCodexProjectSetup({ projectRoot, mode: "apply" });
    assert.equal(first.ok, true);
    const afterFirst = await readFile(join(projectRoot, CODEX_PROJECT_FILENAME), "utf8");

    const second = await runCodexProjectSetup({ projectRoot, mode: "apply" });
    assert.equal(second.ok, true);
    assert.equal(second.changed, false);
    const afterSecond = await readFile(join(projectRoot, CODEX_PROJECT_FILENAME), "utf8");
    assert.equal(afterSecond, afterFirst);
  });

  it("rejects malformed marker blocks", async () => {
    const projectRoot = join(tempRoot, "malformed");
    await seedLocalFiles(projectRoot);
    const agentsPath = join(projectRoot, CODEX_PROJECT_FILENAME);
    await writeFile(
      agentsPath,
      `${CODEX_MARKER.begin}\n## broken\n`,
      "utf8"
    );

    await assert.rejects(
      () => runCodexProjectSetup({ projectRoot, mode: "apply" }),
      MarkerBlockError
    );
  });

  it("errors on apply when projection files are missing", async () => {
    const projectRoot = join(tempRoot, "missing-files");
    await mkdir(join(projectRoot, PROJECT_LOCAL_DIR), { recursive: true });

    const result = await runCodexProjectSetup({ projectRoot, mode: "apply" });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), new RegExp(PROJECTION_MATERIALIZATION_REQUIRED));
  });

  it("dry-run warns when projection files are missing", async () => {
    const projectRoot = join(tempRoot, "missing-files-dry-run");
    await mkdir(join(projectRoot, PROJECT_LOCAL_DIR), { recursive: true });

    const result = await runCodexProjectSetup({ projectRoot, mode: "dry-run" });
    assert.equal(result.ok, true);
    assert.match(result.warnings.join("\n"), new RegExp(PROJECTION_MATERIALIZATION_REQUIRED));
  });
});

describe("Codex marker blocks", () => {
  it("upserts without touching user content", () => {
    const inner = ["## AMP Project Projection", "", "body"];
    const updated = upsertMarkerBlockFor("# User\n", inner, CODEX_MARKER);
    assert.match(updated, /^# User/);
    assert.match(updated, /## AMP Project Projection/);
  });
});
