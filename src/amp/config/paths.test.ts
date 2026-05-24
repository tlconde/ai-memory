import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import {
  AMP_RUNTIME_PATH_ENV,
  AMP_USER_CONFIG_PATH_ENV,
  defaultRuntimeDbPath,
  defaultUserConfigPath,
  projectConfigPath,
} from "./paths.js";

describe("defaultRuntimeDbPath", () => {
  it("uses macOS Application Support default", () => {
    const path = defaultRuntimeDbPath({
      platform: "darwin",
      homedir: () => "/Users/test",
      env: {},
    });
    assert.equal(path, "/Users/test/Library/Application Support/amp/runtime.db");
  });

  it("uses Linux XDG_DATA_HOME default", () => {
    const path = defaultRuntimeDbPath({
      platform: "linux",
      homedir: () => "/home/test",
      env: { XDG_DATA_HOME: "/data/home/test" },
    });
    assert.equal(path, "/data/home/test/amp/runtime.db");
  });

  it("uses AMP_RUNTIME_PATH when set", () => {
    const path = defaultRuntimeDbPath({
      platform: "linux",
      homedir: () => "/home/test",
      env: { [AMP_RUNTIME_PATH_ENV]: "/tmp/test/runtime.db" },
    });
    assert.equal(path, "/tmp/test/runtime.db");
  });
});

describe("defaultUserConfigPath", () => {
  it("uses macOS Application Support config path", () => {
    const path = defaultUserConfigPath({
      platform: "darwin",
      homedir: () => "/Users/test",
      env: {},
    });
    assert.equal(path, "/Users/test/Library/Application Support/amp/config.yaml");
  });

  it("uses Linux XDG_CONFIG_HOME config path", () => {
    const path = defaultUserConfigPath({
      platform: "linux",
      homedir: () => "/home/test",
      env: { XDG_CONFIG_HOME: "/cfg/home/test" },
    });
    assert.equal(path, "/cfg/home/test/amp/config.yaml");
  });

  it("uses AMP_USER_CONFIG_PATH when set", () => {
    const path = defaultUserConfigPath({
      platform: "linux",
      homedir: () => "/home/test",
      env: { [AMP_USER_CONFIG_PATH_ENV]: "/tmp/user-config.yaml" },
    });
    assert.equal(path, "/tmp/user-config.yaml");
  });
});

describe("projectConfigPath", () => {
  it("resolves under project root .amp/config.yaml", () => {
    const path = projectConfigPath("/repo/project", { env: {} });
    assert.equal(path, join("/repo/project", ".amp", "config.yaml"));
  });
});
