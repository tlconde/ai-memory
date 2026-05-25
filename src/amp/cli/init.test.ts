import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";

import { discoverAmpConfig } from "../config/discovery.js";
import { AMP_USER_CONFIG_PATH_ENV, PROJECT_CONFIG_REL } from "../config/paths.js";
import { parseAmpConfigFile } from "../config/schema.js";
import {
  AMP_GITIGNORE_MARKER,
  AMP_LOCAL_DIR_REL,
  AMP_RUNTIME_DIR_REL,
  DEFAULT_AMP_GITIGNORE_LINES,
} from "../gitignore/paths.js";
import {
  defaultProjectRuntimeDbPath,
  formatAmpInitMessages,
  PROJECT_LOCAL_DIR_REL,
  PROJECT_RUNTIME_DIR_REL,
  runAmpInit,
} from "./init.js";

describe("runAmpInit", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-init-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("creates project config and runtime directory without harness artifacts", async () => {
    const projectRoot = join(tempRoot, "fresh-project");
    const result = await runAmpInit({ projectRoot });

    assert.equal(result.configCreated, true);
    assert.equal(result.configSkippedExisting, false);
    assert.equal(result.runtimeDirCreated, true);
    assert.equal(result.configPath, join(projectRoot, PROJECT_CONFIG_REL));
    assert.equal(result.runtimeDbPath, defaultProjectRuntimeDbPath(projectRoot));

    const configYaml = await readFile(result.configPath, "utf8");
    const parsed = parseAmpConfigFile(yaml.load(configYaml));
    assert.equal(parsed.project_ref, "fresh-project");
    assert.equal(parsed.runtime?.db_path, defaultProjectRuntimeDbPath(projectRoot));

    await access(join(projectRoot, PROJECT_RUNTIME_DIR_REL));
    await access(join(projectRoot, PROJECT_LOCAL_DIR_REL));
    assert.equal(existsSync(join(projectRoot, ".amp", "local", "projection.md")), false);
    assert.equal(existsSync(join(projectRoot, ".amp", "local", "runtime.md")), false);
    assert.equal(existsSync(join(projectRoot, ".cursor", "rules", "from-amp")), false);
    assert.equal(existsSync(join(projectRoot, ".claude", "skills", "from-amp")), false);
    assert.equal(existsSync(join(projectRoot, "skills", "from-amp")), false);
  });

  it("does not overwrite existing config without --force", async () => {
    const projectRoot = join(tempRoot, "existing-config");
    await runAmpInit({ projectRoot });

    const configPath = join(projectRoot, PROJECT_CONFIG_REL);
    await writeFile(
      configPath,
      [
        "amp_config_version: '1.0'",
        "project_ref: keep-me",
        "runtime:",
        `  db_path: ${defaultProjectRuntimeDbPath(projectRoot)}`,
        "",
      ].join("\n"),
      "utf8"
    );

    const result = await runAmpInit({ projectRoot });
    assert.equal(result.configCreated, false);
    assert.equal(result.configSkippedExisting, true);
    assert.match(await readFile(configPath, "utf8"), /keep-me/);
  });

  it("overwrites existing config when --force is set", async () => {
    const projectRoot = join(tempRoot, "force-overwrite");
    await runAmpInit({ projectRoot });

    const configPath = join(projectRoot, PROJECT_CONFIG_REL);
    await writeFile(
      configPath,
      [
        "amp_config_version: '1.0'",
        "project_ref: stale",
        "runtime:",
        `  db_path: ${defaultProjectRuntimeDbPath(projectRoot)}`,
        "",
      ].join("\n"),
      "utf8"
    );

    const result = await runAmpInit({ projectRoot, force: true });
    assert.equal(result.configCreated, true);
    assert.equal(result.configSkippedExisting, false);
    assert.match(await readFile(configPath, "utf8"), /project_ref: force-overwrite/);
  });

  it("resolves runtime path via config discovery after init", async () => {
    const projectRoot = join(tempRoot, "discovery-project");
    await runAmpInit({ projectRoot });

    const resolved = discoverAmpConfig({
      projectRoot,
      env: {
        [AMP_USER_CONFIG_PATH_ENV]: join(projectRoot, "missing-user-config.yaml"),
      },
      platform: "linux",
      homedir: () => join(projectRoot, "home"),
    });

    assert.equal(resolved.runtime.dbPath, defaultProjectRuntimeDbPath(projectRoot));
    assert.equal(resolved.sources.runtimePathSource, "project");
    assert.equal(resolved.projectRef, "discovery-project");
  });

  it("ensures gitignore protection for AMP local and runtime paths", async () => {
    const projectRoot = join(tempRoot, "gitignore-protection");
    const result = await runAmpInit({ projectRoot });

    assert.equal(result.localDirCreated, true);
    assert.equal(result.gitignoreCreated, true);
    assert.deepEqual(result.gitignoreEntriesAdded, [...DEFAULT_AMP_GITIGNORE_LINES]);
    assert.deepEqual(result.gitignoreEntriesPresent, []);

    const gitignore = await readFile(result.gitignorePath, "utf8");
    assert.ok(gitignore.includes(AMP_GITIGNORE_MARKER));
    assert.match(gitignore, new RegExp(`^${AMP_LOCAL_DIR_REL.replace("/", "\\/")}$`, "m"));
    assert.match(gitignore, new RegExp(`^${AMP_RUNTIME_DIR_REL.replace("/", "\\/")}$`, "m"));
  });

  it("does not duplicate gitignore entries on repeated init", async () => {
    const projectRoot = join(tempRoot, "gitignore-idempotent");
    const first = await runAmpInit({ projectRoot });
    const before = await readFile(first.gitignorePath, "utf8");

    const second = await runAmpInit({ projectRoot });
    const after = await readFile(second.gitignorePath, "utf8");

    assert.deepEqual(second.gitignoreEntriesAdded, []);
    assert.deepEqual(second.gitignoreEntriesPresent, [...DEFAULT_AMP_GITIGNORE_LINES]);
    assert.equal(before, after);
  });

  it("prints gitignore protection in init output", () => {
    const messages = formatAmpInitMessages({
      projectRoot: "/tmp/project",
      configPath: "/tmp/project/.amp/config.yaml",
      configCreated: true,
      configSkippedExisting: false,
      runtimeDbPath: "/tmp/project/.amp/runtime/runtime.db",
      runtimeDirCreated: true,
      localDirCreated: true,
      gitignorePath: "/tmp/project/.gitignore",
      gitignoreCreated: true,
      gitignoreEntriesAdded: [...DEFAULT_AMP_GITIGNORE_LINES],
      gitignoreEntriesPresent: [],
    });

    assert.match(messages.join("\n"), /amp doctor/i);
    assert.match(messages.join("\n"), /\.gitignore.*AMP local\/runtime protection/i);
  });

  it("prints next-step guidance to run amp doctor", () => {
    const messages = formatAmpInitMessages({
      projectRoot: "/tmp/project",
      configPath: "/tmp/project/.amp/config.yaml",
      configCreated: true,
      configSkippedExisting: false,
      runtimeDbPath: "/tmp/project/.amp/runtime/runtime.db",
      runtimeDirCreated: true,
      localDirCreated: false,
      gitignorePath: "/tmp/project/.gitignore",
      gitignoreCreated: false,
      gitignoreEntriesAdded: [],
      gitignoreEntriesPresent: [...DEFAULT_AMP_GITIGNORE_LINES],
    });

    assert.match(messages.join("\n"), /amp doctor/i);
    assert.match(messages.join("\n"), /\.gitignore already protects AMP local\/runtime paths/i);
  });
});
