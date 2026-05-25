import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";
import { ReadonlyGbrainMcpTransport } from "../adapters/ssa/gbrain/readonly-transport.js";
import {
  GbrainProjectionSource,
  type GbrainProjectionSourceOptions,
} from "../projection/gbrain-source.js";
import { AMP_KNOWLEDGE_BACKEND_ENV } from "./knowledge-backend.js";
import { createProjectionRenderSource } from "./projection-source.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function gbrainAdapterFromSource(source: GbrainProjectionSource): GbrainKnowledgeAdapter {
  return (source as unknown as { options: GbrainProjectionSourceOptions }).options.adapter;
}

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

  it("wraps fake-gbrain factory adapter with readonly transport", async () => {
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "readonly-fake-gbrain-runtime.db") });
    try {
      const resolved = createProjectionRenderSource({
        sourceKind: "gbrain",
        runtimeDbPath: join(tempDir, "readonly-fake-gbrain-runtime.db"),
        env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "fake-gbrain" },
        ampRepoRoot: REPO_ROOT,
        deps: { openRuntimeStore: () => runtime },
      });

      assert.ok(!("error" in resolved));
      assert.ok(resolved.source instanceof GbrainProjectionSource);

      const adapter = gbrainAdapterFromSource(resolved.source);
      assert.ok(adapter.transport instanceof ReadonlyGbrainMcpTransport);

      await assert.rejects(
        () =>
          adapter.transport.callTool("put_page", {
            slug: "amp/frames/h.readonly-factory-probe",
            content: "Must not reach gbrain.",
          }),
        /Readonly gbrain transport rejected mutating tool put_page/
      );
    } finally {
      runtime.close();
    }
  });
});
