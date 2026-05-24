import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { AmpError, AmpErrorCode } from "../core/errors.js";
import {
  AMP_PROJECT_CONFIG_PATH_ENV,
  AMP_RUNTIME_PATH_ENV,
  AMP_USER_CONFIG_PATH_ENV,
  PROJECT_CONFIG_REL,
} from "./paths.js";
import { discoverAmpConfig } from "./discovery.js";

describe("discoverAmpConfig", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-config-discovery-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("uses platform default when no config files exist", () => {
    const resolved = discoverAmpConfig({
      projectRoot: tempRoot,
      platform: "darwin",
      homedir: () => join(tempRoot, "home"),
      env: {
        [AMP_USER_CONFIG_PATH_ENV]: join(tempRoot, "missing-user.yaml"),
        [AMP_PROJECT_CONFIG_PATH_ENV]: join(tempRoot, "missing-project.yaml"),
      },
    });

    assert.equal(
      resolved.runtime.dbPath,
      join(tempRoot, "home", "Library", "Application Support", "amp", "runtime.db")
    );
    assert.equal(resolved.sources.runtimePathSource, "platform-default");
    assert.equal(resolved.projectRef, undefined);
  });

  it("merges user config runtime path over platform default", async () => {
    const userConfigPath = join(tempRoot, "user-config.yaml");
    await writeFile(
      userConfigPath,
      "project_ref: user-project\nruntime:\n  db_path: /tmp/user-runtime.db\n"
    );

    const resolved = discoverAmpConfig({
      projectRoot: tempRoot,
      platform: "linux",
      homedir: () => join(tempRoot, "home"),
      env: {
        [AMP_USER_CONFIG_PATH_ENV]: userConfigPath,
        [AMP_PROJECT_CONFIG_PATH_ENV]: join(tempRoot, "missing-project.yaml"),
      },
    });

    assert.equal(resolved.runtime.dbPath, "/tmp/user-runtime.db");
    assert.equal(resolved.sources.runtimePathSource, "user");
    assert.equal(resolved.projectRef, "user-project");
    assert.equal(resolved.sources.userConfigPath, userConfigPath);
  });

  it("merges project config runtime path over user config", async () => {
    const userConfigPath = join(tempRoot, "user-override.yaml");
    await writeFile(
      userConfigPath,
      "runtime:\n  db_path: /tmp/user-runtime.db\n"
    );

    const projectRoot = join(tempRoot, "project");
    const projectConfigPath = join(projectRoot, PROJECT_CONFIG_REL);
    await mkdir(join(projectRoot, ".amp"), { recursive: true });
    await writeFile(
      projectConfigPath,
      "project_ref: repo-project\nruntime:\n  db_path: /tmp/project-runtime.db\n"
    );

    const resolved = discoverAmpConfig({
      projectRoot,
      platform: "linux",
      homedir: () => join(tempRoot, "home"),
      env: {
        [AMP_USER_CONFIG_PATH_ENV]: userConfigPath,
      },
    });

    assert.equal(resolved.runtime.dbPath, "/tmp/project-runtime.db");
    assert.equal(resolved.sources.runtimePathSource, "project");
    assert.equal(resolved.projectRef, "repo-project");
    assert.equal(resolved.sources.projectConfigPath, projectConfigPath);
  });

  it("uses AMP_RUNTIME_PATH env over config files", async () => {
    const userConfigPath = join(tempRoot, "env-precedence-user.yaml");
    await writeFile(userConfigPath, "runtime:\n  db_path: /tmp/user-runtime.db\n");

    const projectRoot = join(tempRoot, "env-project");
    await mkdir(join(projectRoot, ".amp"), { recursive: true });
    await writeFile(
      join(projectRoot, PROJECT_CONFIG_REL),
      "runtime:\n  db_path: /tmp/project-runtime.db\n"
    );

    const resolved = discoverAmpConfig({
      projectRoot,
      platform: "linux",
      homedir: () => join(tempRoot, "home"),
      env: {
        [AMP_RUNTIME_PATH_ENV]: "/tmp/env-runtime.db",
        [AMP_USER_CONFIG_PATH_ENV]: userConfigPath,
      },
    });

    assert.equal(resolved.runtime.dbPath, "/tmp/env-runtime.db");
    assert.equal(resolved.sources.runtimePathSource, "env");
  });

  it("throws frame schema mismatch for invalid config YAML", async () => {
    const userConfigPath = join(tempRoot, "invalid-user.yaml");
    await writeFile(userConfigPath, "unexpected_key: true\n");

    assert.throws(
      () =>
        discoverAmpConfig({
          platform: "linux",
          homedir: () => join(tempRoot, "home"),
          env: { [AMP_USER_CONFIG_PATH_ENV]: userConfigPath },
        }),
      (error: unknown) => {
        assert.ok(error instanceof AmpError);
        assert.equal(error.code, AmpErrorCode.FRAME_SCHEMA_MISMATCH);
        return true;
      }
    );
  });
});
