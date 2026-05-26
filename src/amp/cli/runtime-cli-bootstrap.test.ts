import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { runAmpInit } from "./init.js";
import { runAmpRuntimeInspect } from "./runtime-inspect.js";
import { runAmpRuntimeSeed } from "./runtime-seed.js";
import {
  resolveAmpRuntimeCliBootstrap,
  withAmpRuntimeCliStore,
} from "./runtime-cli-bootstrap.js";

describe("resolveAmpRuntimeCliBootstrap", () => {
  it("returns a clear error when project AMP config is missing", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "amp-runtime-bootstrap-missing-config-"));

    try {
      const result = resolveAmpRuntimeCliBootstrap({ projectRoot });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.error, /Project AMP config not found/);
        assert.match(result.error, /amp init/);
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("resolves runtime DB path for initialized projects", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "amp-runtime-bootstrap-init-"));
    const projectRoot = join(tempRoot, "project");
    const fakeHome = join(tempRoot, "home");
    const env = { HOME: fakeHome };

    try {
      await runAmpInit({ projectRoot, env });

      const result = resolveAmpRuntimeCliBootstrap({
        projectRoot,
        env,
        homedir: () => fakeHome,
      });

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.projectRoot, projectRoot);
        assert.match(result.runtimeDbPath, /runtime\.db$/);
      }
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("withAmpRuntimeCliStore", () => {
  it("closes the runtime store after the callback completes", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "amp-runtime-bootstrap-close-"));
    const projectRoot = join(tempRoot, "project");
    const fakeHome = join(tempRoot, "home");
    const env = { HOME: fakeHome };

    try {
      await runAmpInit({ projectRoot, env });
      const bootstrap = resolveAmpRuntimeCliBootstrap({
        projectRoot,
        env,
        homedir: () => fakeHome,
      });
      assert.equal(bootstrap.ok, true);
      if (!bootstrap.ok) {
        return;
      }

      let closeCalls = 0;
      const runtime = new RuntimeStore({ dbPath: bootstrap.runtimeDbPath });
      const originalClose = runtime.close.bind(runtime);
      runtime.close = () => {
        closeCalls += 1;
        originalClose();
      };

      const value = withAmpRuntimeCliStore(
        bootstrap,
        { deps: { openRuntimeStore: () => runtime } },
        () => "done",
      );

      assert.equal(value, "done");
      assert.equal(closeCalls, 1);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("runtime CLI bootstrap integration", () => {
  it("returns missing-config errors for seed and inspect", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "amp-runtime-bootstrap-cli-missing-"));

    try {
      const seedResult = await runAmpRuntimeSeed({
        projectRoot,
        file: join(projectRoot, "seed.json"),
      });
      assert.equal(seedResult.ok, false);
      assert.match(seedResult.error ?? "", /Project AMP config not found/);

      const inspectResult = runAmpRuntimeInspect({ projectRoot });
      assert.equal(inspectResult.ok, false);
      assert.match(inspectResult.error ?? "", /Project AMP config not found/);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
