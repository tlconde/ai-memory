import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AMP_USER_CONFIG_PATH_ENV } from "../config/paths.js";
import { formatAmpCaptureMessages, runAmpCapture } from "./capture.js";
import { runAmpInit } from "./init.js";

describe("runAmpCapture", () => {
  let tempRoot = "";

  before(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "amp-capture-cli-"));
  });

  after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("enqueues a preference in the configured runtime store", async () => {
    const projectRoot = join(tempRoot, "capture-project");
    await runAmpInit({ projectRoot });

    const result = runAmpCapture({
      projectRoot,
      content: "Prefer small atomic commits.",
      scope: "project",
      env: {
        [AMP_USER_CONFIG_PATH_ENV]: join(projectRoot, "missing-user-config.yaml"),
      },
    });

    assert.equal(result.queued, true);
    assert.match(result.signalId, /^[0-9a-f-]{36}$/i);
    assert.equal(result.scope, "project");
    assert.equal(result.projectRef, "capture-project");
  });

  it("throws when project scope lacks projectRef and config has none", () => {
    const projectRoot = join(tempRoot, "no-config");

    assert.throws(
      () =>
        runAmpCapture({
          projectRoot,
          content: "Missing ref.",
          scope: "project",
          env: {
            [AMP_USER_CONFIG_PATH_ENV]: join(projectRoot, "missing-user-config.yaml"),
            AMP_RUNTIME_PATH: join(projectRoot, "runtime.db"),
          },
        }),
      (error: unknown) =>
        error instanceof Error && error.message === "project scope requires projectRef"
    );
  });

  it("formatAmpCaptureMessages includes signal id and next step", () => {
    const lines = formatAmpCaptureMessages({
      signalId: "sig-123",
      queued: true,
      projectRoot: "/tmp/project",
      runtimeDbPath: "/tmp/project/.amp/runtime/runtime.db",
      scope: "project",
      projectRef: "project",
    });

    assert.match(lines.join("\n"), /sig-123/);
    assert.match(lines.join("\n"), /amp consolidate/i);
  });
});
