import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RuntimeStore } from "./runtime-store.js";

describe("runtime / knowledge isolation", () => {
  let tempDir = "";
  let runtime: RuntimeStore;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-isolation-"));
    runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
  });

  after(async () => {
    runtime.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("runtime kv entries do not include curation_mode", () => {
    runtime.set("sync_state.cursor", { last_seen: "2026-05-24T12:00:00.000Z" });
    const value = runtime.get<Record<string, unknown>>("sync_state.cursor");
    assert.ok(value);
    assert.equal("curation_mode" in value!, false);
  });

  it("queued episodic signals may omit curation_mode until consolidation", () => {
    runtime.queuePush({
      id: "queue-1",
      kind: "episodic_signal",
      enqueued_at: "2026-05-24T12:00:00.000Z",
      payload: {
        id: "sig-1",
        content: "Prefer concise commit messages.",
        scope: "project",
        projectRef: "ai-memory",
        source: { surface: "cursor", captured_at: "2026-05-24T12:00:00.000Z" },
      },
    });

    const item = runtime.queuePeek();
    assert.equal(item?.payload.curationMode, undefined);
  });
});

describe("runtime store path isolation", () => {
  it("uses isolated temp path in tests rather than user defaults", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-path-"));
    const dbPath = join(tempDir, "runtime.db");
    const store = new RuntimeStore({ dbPath });
    store.set("probe", { ok: true });
    store.close();
    await rm(tempDir, { recursive: true, force: true });
    assert.ok(dbPath.includes("amp-runtime-path-"));
  });
});
