/**
 * §10.4.1 graph_traversal (wrapped) — offline coverage via FakeGbrainMcpTransport.
 * Live parity: src/amp/integration/gbrain-graph-live.test.ts (AMP_LIVE_GBRAIN=1).
 */

import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createFrame } from "../../../core/frame-schema.js";
import { GbrainKnowledgeAdapter, AMP_FRAME_LINK_TYPES } from "./adapter.js";
import { FakeGbrainMcpTransport } from "./fake-transport.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../../");
const GBRAIN_SPEC = join(REPO_ROOT, "ssa-files/gbrain.yaml");

function frame(id: string, content: string, extra: Record<string, unknown> = {}) {
  return createFrame({
    id,
    kind: "semantic",
    content,
    source: { surface: "cursor" },
    created_at: "2026-05-29T12:00:00.000Z",
    scope: { kind: "project", project_ref: "ai-memory" },
    curation_mode: "personal",
    ...extra,
  });
}

describe("GbrainKnowledgeAdapter graph_traversal (wrapped)", () => {
  it("declares graph_traversal as wrapped (not unsupported)", () => {
    const adapter = new GbrainKnowledgeAdapter({
      transport: new FakeGbrainMcpTransport(),
      ssaSpecPath: GBRAIN_SPEC,
    });
    assert.notEqual(adapter.capabilities().graph_traversal, "unsupported");
  });

  it("emits a typed edge for supersedes and traverses to the superseded frame", async () => {
    const adapter = new GbrainKnowledgeAdapter({
      transport: new FakeGbrainMcpTransport(),
      ssaSpecPath: GBRAIN_SPEC,
    });

    await adapter.writeFrames([frame("frame-old", "old guidance")]);
    await adapter.writeFrames([
      frame("frame-new", "new guidance", { supersedes: ["frame-old"] }),
    ]);

    const out = await adapter.graphTraversal("frame-new", { direction: "out" });
    assert.equal(out.success, true);
    assert.ok(out.success);
    assert.deepEqual(
      out.hits.map((h) => h.item.id),
      ["frame-old"]
    );
  });

  it("supports addLink + directional traversal (in/out)", async () => {
    const adapter = new GbrainKnowledgeAdapter({
      transport: new FakeGbrainMcpTransport(),
      ssaSpecPath: GBRAIN_SPEC,
    });

    await adapter.writeFrames([frame("frame-x", "x"), frame("frame-y", "y")]);
    const link = await adapter.addLink("frame-x", "frame-y", AMP_FRAME_LINK_TYPES.supersedes);
    assert.equal(link.success, true);

    const out = await adapter.graphTraversal("frame-x", { direction: "out" });
    assert.ok(out.success);
    assert.deepEqual(out.hits.map((h) => h.item.id), ["frame-y"]);

    const incoming = await adapter.graphTraversal("frame-y", { direction: "in" });
    assert.ok(incoming.success);
    assert.deepEqual(incoming.hits.map((h) => h.item.id), ["frame-x"]);
  });

  it("filters traversal by link_type", async () => {
    const adapter = new GbrainKnowledgeAdapter({
      transport: new FakeGbrainMcpTransport(),
      ssaSpecPath: GBRAIN_SPEC,
    });

    await adapter.writeFrames([frame("a", "a"), frame("b", "b"), frame("c", "c")]);
    await adapter.addLink("a", "b", AMP_FRAME_LINK_TYPES.supersedes);
    await adapter.addLink("a", "c", "amp:related");

    const onlySupersedes = await adapter.graphTraversal("a", {
      direction: "out",
      linkType: AMP_FRAME_LINK_TYPES.supersedes,
    });
    assert.ok(onlySupersedes.success);
    assert.deepEqual(onlySupersedes.hits.map((h) => h.item.id), ["b"]);
  });

  it("returns empty hits for an isolated frame", async () => {
    const adapter = new GbrainKnowledgeAdapter({
      transport: new FakeGbrainMcpTransport(),
      ssaSpecPath: GBRAIN_SPEC,
    });
    await adapter.writeFrames([frame("lonely", "no edges")]);

    const out = await adapter.graphTraversal("lonely", { direction: "out" });
    assert.ok(out.success);
    assert.equal(out.hits.length, 0);
  });
});
