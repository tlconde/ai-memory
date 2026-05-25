import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";
import {
  encodeFrameToPageContent,
  frameIdToSlug,
} from "../adapters/ssa/gbrain/frame-codec.js";
import { FakeGbrainMcpTransport } from "../adapters/ssa/gbrain/fake-transport.js";
import { ReadonlyGbrainMcpTransport } from "../adapters/ssa/gbrain/readonly-transport.js";
import type { GbrainMcpTransport } from "../adapters/ssa/gbrain/transport.js";
import { createFrame } from "../core/frame-schema.js";
import { capturePreference } from "../substrate/capture-preference.js";
import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { GbrainProjectionSource } from "./gbrain-source.js";
import { ProjectionSourceLoadError } from "./errors.js";
import { GBRAIN_PROJECTION_READ_FAILED } from "./messages.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const GBRAIN_SPEC = join(REPO_ROOT, "ssa-files/gbrain.yaml");

const MUTATING_GBRAIN_TOOLS = new Set(["put_page", "delete_page", "restore_page"]);

class TrackingGbrainMcpTransport implements GbrainMcpTransport {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  constructor(private readonly inner: GbrainMcpTransport) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ name, args });
    return this.inner.callTool(name, args);
  }

  async close(): Promise<void> {
    await this.inner.close?.();
  }
}

class FailingListPagesTransport implements GbrainMcpTransport {
  constructor(private readonly inner: FakeGbrainMcpTransport) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "list_pages") {
      throw new Error("gbrain MCP list_pages failed: simulated outage");
    }
    return this.inner.callTool(name, args);
  }
}

function seedFrame(transport: FakeGbrainMcpTransport, frame: ReturnType<typeof createFrame>): void {
  transport.seedPage(frameIdToSlug(frame.id), encodeFrameToPageContent(frame));
}

describe("GbrainProjectionSource", () => {
  let tempDir = "";
  let runtime: RuntimeStore;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "amp-gbrain-projection-source-"));
    runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
  });

  after(async () => {
    runtime.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("exposes gbrain sourceKind and supports apply", () => {
    const fake = new FakeGbrainMcpTransport();
    const adapter = new GbrainKnowledgeAdapter({ transport: fake, ssaSpecPath: GBRAIN_SPEC });
    const source = new GbrainProjectionSource({ adapter, runtime, projectRef: "demo" });

    assert.equal(source.sourceKind, "gbrain");
    assert.equal(source.supportsApply, true);
  });

  it("loads frames from gbrain listFrames into projection documents", async () => {
    const fake = new FakeGbrainMcpTransport();
    seedFrame(
      fake,
      createFrame({
        id: "project-pref",
        kind: "semantic",
        content: "Use conventional commits in this repo.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "project", project_ref: "demo-app" },
        curation_mode: "personal",
      })
    );

    const adapter = new GbrainKnowledgeAdapter({ transport: fake, ssaSpecPath: GBRAIN_SPEC });
    const source = new GbrainProjectionSource({
      adapter,
      runtime,
      projectRef: "demo-app",
      generatedAt: "2026-05-25T12:00:00.000Z",
    });
    const documents = await source.loadProjectionDocuments({ projectRef: "demo-app" });

    const projectProjection = documents.find((doc) => doc.metadata.kind === "project_projection");
    assert.match(projectProjection?.body ?? "", /Use conventional commits in this repo\./);
  });

  it("includes local runtime queue items in scoped runtime sections", async () => {
    const fake = new FakeGbrainMcpTransport();
    const adapter = new GbrainKnowledgeAdapter({ transport: fake, ssaSpecPath: GBRAIN_SPEC });

    capturePreference(runtime, {
      content: "Queued project runtime note.",
      scope: "project",
      projectRef: "demo-app",
    });

    const source = new GbrainProjectionSource({
      adapter,
      runtime,
      projectRef: "demo-app",
      generatedAt: "2026-05-25T12:00:00.000Z",
    });
    const documents = await source.loadProjectionDocuments({ projectRef: "demo-app" });

    const projectRuntime = documents.find((doc) => doc.metadata.kind === "project_runtime");
    assert.match(projectRuntime?.body ?? "", /Queued project runtime note\./);
  });

  it("does not call gbrain write/mutate/delete MCP tools during load", async () => {
    const inner = new FakeGbrainMcpTransport();
    seedFrame(
      inner,
      createFrame({
        id: "read-only-frame",
        kind: "semantic",
        content: "Read-only projection probe.",
        source: { surface: "cursor" },
        created_at: "2026-05-25T00:00:00.000Z",
        scope: { kind: "project", project_ref: "demo-app" },
        curation_mode: "personal",
      })
    );

    const tracking = new TrackingGbrainMcpTransport(new ReadonlyGbrainMcpTransport(inner));
    const adapter = new GbrainKnowledgeAdapter({ transport: tracking, ssaSpecPath: GBRAIN_SPEC });

    const source = new GbrainProjectionSource({ adapter, runtime, projectRef: "demo-app" });
    await source.loadProjectionDocuments({ projectRef: "demo-app" });

    const mutatingCalls = tracking.calls.filter((call) => MUTATING_GBRAIN_TOOLS.has(call.name));
    assert.deepEqual(mutatingCalls, []);
    assert.ok(tracking.calls.some((call) => call.name === "list_pages"));
    assert.ok(tracking.calls.some((call) => call.name === "get_page"));
  });

  it("throws ProjectionSourceLoadError with operator message on list failure", async () => {
    const failing = new FailingListPagesTransport(new FakeGbrainMcpTransport());
    const adapter = new GbrainKnowledgeAdapter({ transport: failing, ssaSpecPath: GBRAIN_SPEC });
    const source = new GbrainProjectionSource({ adapter, runtime, projectRef: "demo-app" });

    await assert.rejects(
      () => source.loadProjectionDocuments({ projectRef: "demo-app" }),
      (error: unknown) => {
        assert.ok(error instanceof ProjectionSourceLoadError);
        assert.match(error.message, new RegExp(GBRAIN_PROJECTION_READ_FAILED));
        assert.match(error.message, /simulated outage/);
        return true;
      }
    );
  });
});
