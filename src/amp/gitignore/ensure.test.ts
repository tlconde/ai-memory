import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AMP_GITIGNORE_MARKER,
  AMP_LOCAL_DIR_REL,
  AMP_RUNTIME_DIR_REL,
  DEFAULT_AMP_GITIGNORE_LINES,
} from "./paths.js";
import { ensureAmpGitignoreEntries } from "./ensure.js";

async function makeProjectDir(tempRoot: string, name: string): Promise<string> {
  const projectRoot = join(tempRoot, name);
  await mkdir(projectRoot, { recursive: true });
  return projectRoot;
}

describe("ensureAmpGitignoreEntries", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-gitignore-ensure-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("creates .gitignore with AMP-managed block", async () => {
    const projectRoot = await makeProjectDir(tempRoot, "new-project");

    const result = await ensureAmpGitignoreEntries(projectRoot);

    assert.equal(result.gitignoreCreated, true);
    assert.deepEqual(result.entriesAdded, [...DEFAULT_AMP_GITIGNORE_LINES]);
    assert.deepEqual(result.entriesPresent, []);

    const content = await readFile(result.gitignorePath, "utf8");
    assert.ok(content.includes(AMP_GITIGNORE_MARKER));
    assert.match(content, new RegExp(`^${AMP_LOCAL_DIR_REL.replace("/", "\\/")}$`, "m"));
    assert.match(content, new RegExp(`^${AMP_RUNTIME_DIR_REL.replace("/", "\\/")}$`, "m"));
  });

  it("appends missing entries while preserving unrelated rules", async () => {
    const projectRoot = await makeProjectDir(tempRoot, "existing-gitignore");
    const gitignorePath = join(projectRoot, ".gitignore");
    await writeFile(gitignorePath, "node_modules/\n.DS_Store\n", "utf8");

    const result = await ensureAmpGitignoreEntries(projectRoot);

    assert.equal(result.gitignoreCreated, false);
    assert.deepEqual(result.entriesAdded, [...DEFAULT_AMP_GITIGNORE_LINES]);

    const content = await readFile(gitignorePath, "utf8");
    assert.match(content, /^node_modules\/$/m);
    assert.match(content, /^\.DS_Store$/m);
    assert.match(content, new RegExp(`^${AMP_LOCAL_DIR_REL.replace("/", "\\/")}$`, "m"));
  });

  it("is idempotent when AMP entries already exist", async () => {
    const projectRoot = await makeProjectDir(tempRoot, "idempotent");

    const first = await ensureAmpGitignoreEntries(projectRoot);
    const before = await readFile(first.gitignorePath, "utf8");

    const second = await ensureAmpGitignoreEntries(projectRoot);
    const after = await readFile(second.gitignorePath, "utf8");

    assert.deepEqual(second.entriesAdded, []);
    assert.deepEqual(second.entriesPresent, [...DEFAULT_AMP_GITIGNORE_LINES]);
    assert.equal(before, after);
  });

  it("adds only missing entries when one AMP line is already present", async () => {
    const projectRoot = await makeProjectDir(tempRoot, "partial");
    await writeFile(join(projectRoot, ".gitignore"), `${AMP_LOCAL_DIR_REL}\n`, "utf8");

    const result = await ensureAmpGitignoreEntries(projectRoot);

    assert.deepEqual(result.entriesPresent, [AMP_LOCAL_DIR_REL]);
    assert.deepEqual(result.entriesAdded, [AMP_RUNTIME_DIR_REL]);

    const content = await readFile(result.gitignorePath, "utf8");
    const localMatches = content.match(new RegExp(`^${AMP_LOCAL_DIR_REL.replace("/", "\\/")}$`, "gm"));
    assert.equal(localMatches?.length, 1);
  });

  it("can omit the marker comment block", async () => {
    const projectRoot = await makeProjectDir(tempRoot, "no-marker");

    await ensureAmpGitignoreEntries(projectRoot, { includeMarker: false });

    const content = await readFile(join(projectRoot, ".gitignore"), "utf8");
    assert.doesNotMatch(content, /Invariant 6/);
    assert.match(content, new RegExp(`^${AMP_LOCAL_DIR_REL.replace("/", "\\/")}$`, "m"));
  });
});

function gitInit(projectRoot: string): void {
  const result = spawnSync("git", ["init"], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr?.toString() ?? "git init failed");
}

describe("ensureAmpGitignoreEntries in git repos", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-gitignore-ensure-git-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("works inside a git repository", async () => {
    const projectRoot = await makeProjectDir(tempRoot, "git-repo");
    gitInit(projectRoot);

    const result = await ensureAmpGitignoreEntries(projectRoot);
    assert.deepEqual(result.entriesAdded, [...DEFAULT_AMP_GITIGNORE_LINES]);
  });
});
