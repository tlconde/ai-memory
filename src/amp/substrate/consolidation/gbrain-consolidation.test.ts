import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { GbrainKnowledgeAdapter } from "../../adapters/ssa/gbrain/adapter.js";
import { FakeGbrainMcpTransport } from "../../adapters/ssa/gbrain/fake-transport.js";
import { frameIdToSlug } from "../../adapters/ssa/gbrain/frame-codec.js";
import type { GbrainMcpTransport } from "../../adapters/ssa/gbrain/transport.js";
import { AmpError } from "../../core/errors.js";
import { consolidateToGbrain } from "./gbrain-consolidation.js";
import { enqueueEpisodicSignal, RuntimeStore } from "../storage/runtime-store.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../");
const GBRAIN_SPEC = join(REPO_ROOT, "ssa-files/gbrain.yaml");

class FailingPutPageTransport implements GbrainMcpTransport {
  async callTool(name: string, _args: Record<string, unknown>): Promise<unknown> {
    if (name === "put_page") {
      throw new Error("gbrain put_page failed");
    }
    throw new Error(`FailingPutPageTransport: unsupported tool ${name}`);
  }
}

class PartialFailPutPageTransport implements GbrainMcpTransport {
  private readonly inner = new FakeGbrainMcpTransport();
  private putCount = 0;

  constructor(private readonly failAfterSuccessCount: number) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "put_page") {
      this.putCount += 1;
      if (this.putCount > this.failAfterSuccessCount) {
        throw new Error("partial gbrain write failure");
      }
    }
    return this.inner.callTool(name, args);
  }

  hasPage(slug: string): boolean {
    return this.inner.hasPage(slug);
  }
}

describe("consolidateToGbrain", () => {
  let tempDir = "";
  let runtime: RuntimeStore;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "amp-gbrain-consolidation-test-"));
    runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
  });

  after(async () => {
    runtime.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("drains queue into gbrain and clears runtime queue", async () => {
    runtime.queueRemoveIds(runtime.queueList().map((item) => item.id));

    enqueueEpisodicSignal(runtime, {
      id: "sig-gbrain-1",
      content: "Always run typecheck before commit.",
      scope: "project",
      projectRef: "ai-memory",
      source: { surface: "cursor", harness: "cursor", captured_at: "2026-05-24T12:00:00.000Z" },
    });

    const fake = new FakeGbrainMcpTransport();
    const adapter = new GbrainKnowledgeAdapter({ transport: fake, ssaSpecPath: GBRAIN_SPEC });

    const result = await consolidateToGbrain(runtime, adapter);
    assert.equal(result.processed, 1);
    assert.deepEqual(result.frameIds, ["frame-sig-gbrain-1"]);
    assert.equal(runtime.queuePeek(), undefined);

    const slug = frameIdToSlug("frame-sig-gbrain-1");
    assert.ok(fake.hasPage(slug));

    const read = await adapter.readFrame("frame-sig-gbrain-1");
    assert.equal(read.success, true);
    if (!read.success) return;
    assert.equal(read.items[0]?.content, "Always run typecheck before commit.");
  });

  it("retains queued signals when gbrain write fails", async () => {
    runtime.queueRemoveIds(runtime.queueList().map((item) => item.id));

    enqueueEpisodicSignal(runtime, {
      id: "sig-gbrain-fail",
      content: "Must survive write failure.",
      scope: "project",
      projectRef: "ai-memory",
      source: { surface: "cursor", harness: "cursor", captured_at: "2026-05-24T12:00:00.000Z" },
    });

    const adapter = new GbrainKnowledgeAdapter({
      transport: new FailingPutPageTransport(),
      ssaSpecPath: GBRAIN_SPEC,
    });

    await assert.rejects(
      () => consolidateToGbrain(runtime, adapter),
      (error: unknown) => error instanceof AmpError && /gbrain MCP put_page failed/.test(error.message)
    );

    const remaining = runtime.queuePeek();
    assert.equal(remaining?.id, "sig-gbrain-fail");
    assert.equal(remaining?.payload.content, "Must survive write failure.");
  });

  it("retains all queued signals on partial gbrain write failure", async () => {
    runtime.queueRemoveIds(runtime.queueList().map((item) => item.id));

    enqueueEpisodicSignal(runtime, {
      id: "sig-partial-1",
      content: "First signal.",
      scope: "project",
      projectRef: "ai-memory",
      source: { surface: "cursor", harness: "cursor", captured_at: "2026-05-24T12:00:00.000Z" },
    });
    enqueueEpisodicSignal(runtime, {
      id: "sig-partial-2",
      content: "Second signal.",
      scope: "project",
      projectRef: "ai-memory",
      source: { surface: "cursor", harness: "cursor", captured_at: "2026-05-24T12:01:00.000Z" },
    });

    const partialTransport = new PartialFailPutPageTransport(1);
    const adapter = new GbrainKnowledgeAdapter({
      transport: partialTransport,
      ssaSpecPath: GBRAIN_SPEC,
    });

    await assert.rejects(
      () => consolidateToGbrain(runtime, adapter),
      (error: unknown) => error instanceof AmpError && /partial gbrain write failure/.test(error.message)
    );

    const remaining = runtime.queueList();
    assert.equal(remaining.length, 2);
    assert.equal(remaining[0]?.id, "sig-partial-1");
    assert.equal(remaining[1]?.id, "sig-partial-2");

    assert.ok(partialTransport.hasPage(frameIdToSlug("frame-sig-partial-1")));
    assert.equal(partialTransport.hasPage(frameIdToSlug("frame-sig-partial-2")), false);
  });

  it("rejects project-scoped signals missing projectRef", async () => {
    runtime.queueRemoveIds(runtime.queueList().map((item) => item.id));

    enqueueEpisodicSignal(runtime, {
      id: "sig-gbrain-missing-ref",
      content: "Missing project ref.",
      scope: "project",
      source: { surface: "cursor", harness: "cursor", captured_at: "2026-05-24T12:00:00.000Z" },
    });

    const adapter = new GbrainKnowledgeAdapter({
      transport: new FakeGbrainMcpTransport(),
      ssaSpecPath: GBRAIN_SPEC,
    });

    await assert.rejects(
      () => consolidateToGbrain(runtime, adapter),
      (error: unknown) => error instanceof AmpError && error.message === "project scope requires projectRef"
    );
    assert.equal(runtime.queuePeek()?.id, "sig-gbrain-missing-ref");
  });
});
