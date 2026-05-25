import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { AMP_KNOWLEDGE_BACKEND_ENV } from "./knowledge-backend.js";
import { createProjectionRenderSource } from "./projection-source.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("createProjectionRenderSource gbrain", () => {
  let tempDir = "";

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "amp-projection-source-gbrain-"));
  });

  after(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns preflight error for invalid knowledge backend env", () => {
    const resolved = createProjectionRenderSource({
      sourceKind: "gbrain",
      runtimeDbPath: join(tempDir, "runtime.db"),
      env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "not-a-backend" },
      ampRepoRoot: REPO_ROOT,
    });

    assert.ok("error" in resolved);
    assert.match(resolved.error, /Invalid knowledge backend/);
  });

  it("creates fake-gbrain source without running strict preflight", () => {
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "fake-gbrain-runtime.db") });
    try {
      const resolved = createProjectionRenderSource({
        sourceKind: "gbrain",
        runtimeDbPath: join(tempDir, "fake-gbrain-runtime.db"),
        env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "fake-gbrain" },
        ampRepoRoot: REPO_ROOT,
        deps: { openRuntimeStore: () => runtime },
      });

      assert.ok(!("error" in resolved));
      assert.equal(resolved.source.sourceKind, "gbrain");
    } finally {
      runtime.close();
    }
  });
});
