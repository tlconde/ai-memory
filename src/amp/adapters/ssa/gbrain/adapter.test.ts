import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AmpErrorCode } from "../../../core/errors.js";
import {
  isUnsupportedCapabilityResult,
  unsupportedSearchResult,
} from "../../../adapter-contract/unsupported-capability.js";
import { createFrame } from "../../../core/frame-schema.js";
import { decodePageContentToFrame, frameIdToSlug } from "./frame-codec.js";
import { FakeGbrainMcpTransport } from "./fake-transport.js";
import { GbrainKnowledgeAdapter } from "./adapter.js";
import { GbrainServeStdioTransport, extractSearchHitRefs } from "./transport.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../../");
const GBRAIN_SPEC = join(REPO_ROOT, "ssa-files/gbrain.yaml");

const SAMPLE_FRAME = createFrame({
  id: "frame-001",
  kind: "semantic",
  content: "Prefer 2-space indentation.",
  source: { surface: "cursor" },
  created_at: "2026-05-24T12:00:00.000Z",
  scope: { kind: "project", project_ref: "ai-memory" },
  curation_mode: "personal",
});

describe("GbrainKnowledgeAdapter with FakeGbrainMcpTransport", () => {
  it("defaults to fake transport unless live stdio is explicitly requested", () => {
    const safeDefault = new GbrainKnowledgeAdapter({ ssaSpecPath: GBRAIN_SPEC });
    assert.ok(safeDefault.transport instanceof FakeGbrainMcpTransport);

    const liveOptIn = new GbrainKnowledgeAdapter({
      ssaSpecPath: GBRAIN_SPEC,
      useLiveTransport: true,
    });
    assert.ok(liveOptIn.transport instanceof GbrainServeStdioTransport);
  });

  it("writes and reads a frame via put_page/get_page", async () => {
    const fake = new FakeGbrainMcpTransport();
    const adapter = new GbrainKnowledgeAdapter({ transport: fake, ssaSpecPath: GBRAIN_SPEC });

    const write = await adapter.writeFrames([SAMPLE_FRAME]);
    assert.equal(write.success, true);
    if (!write.success) return;
    assert.deepEqual(write.ids, ["frame-001"]);

    const slug = frameIdToSlug("frame-001");
    assert.ok(fake.hasPage(slug));

    const read = await adapter.readFrame("frame-001");
    assert.equal(read.success, true);
    if (!read.success) return;
    assert.equal(read.items.length, 1);
    assert.equal(read.items[0]?.content, "Prefer 2-space indentation.");
  });

  it("lists frames with project filter", async () => {
    const fake = new FakeGbrainMcpTransport();
    const adapter = new GbrainKnowledgeAdapter({ transport: fake, ssaSpecPath: GBRAIN_SPEC });
    await adapter.writeFrames([SAMPLE_FRAME]);

    const other = createFrame({
      ...SAMPLE_FRAME,
      id: "frame-002",
      scope: { kind: "user" },
      content: "Other scope",
    });
    await adapter.writeFrames([other]);

    const listed = await adapter.listFrames({ scopeKind: "project", projectRef: "ai-memory" });
    assert.equal(listed.success, true);
    if (!listed.success) return;
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0]?.id, "frame-001");
  });

  it("loads capability coverage from ssa-files/gbrain.yaml", () => {
    const adapter = new GbrainKnowledgeAdapter({
      transport: new FakeGbrainMcpTransport(),
      ssaSpecPath: GBRAIN_SPEC,
    });
    const coverage = adapter.capabilities();
    assert.equal(coverage.graph_traversal, "unsupported");
    assert.equal(coverage.transactions, "unsupported");
    assert.equal(coverage.vector_search, "wrapped");
    assert.equal(coverage.profile_slots, "unsupported");
  });

  it("searches frames via MCP search tool (keyword mode)", async () => {
    const fake = new FakeGbrainMcpTransport();
    const adapter = new GbrainKnowledgeAdapter({ transport: fake, ssaSpecPath: GBRAIN_SPEC });
    await adapter.writeFrames([SAMPLE_FRAME]);

    const search = await adapter.searchFrames("indentation");
    assert.equal(search.success, true);
    if (!search.success) return;
    assert.equal(search.hits.length, 1);
    assert.equal(search.hits[0]?.item.id, "frame-001");
    assert.equal(search.hits[0]?.rank, 0);
  });

  it("searches frames via MCP query tool in hybrid mode", async () => {
    const fake = new FakeGbrainMcpTransport();
    const adapter = new GbrainKnowledgeAdapter({ transport: fake, ssaSpecPath: GBRAIN_SPEC });
    await adapter.writeFrames([SAMPLE_FRAME]);

    const search = await adapter.searchFrames("indentation", { mode: "hybrid" });
    assert.equal(search.success, true);
    if (!search.success) return;
    assert.equal(search.hits.length, 1);
    assert.equal(search.hits[0]?.item.id, "frame-001");
  });

  it("returns capability errors for unsupported operations", async () => {
    const adapter = new GbrainKnowledgeAdapter({
      transport: new FakeGbrainMcpTransport(),
      ssaSpecPath: GBRAIN_SPEC,
    });

    const graphSearch = await adapter.searchFrames("indentation", { mode: "graph" });
    assert.equal(isUnsupportedCapabilityResult(graphSearch), true);

    const mutate = await adapter.mutateFrame("frame-001", { content: "x" });
    assert.equal(isUnsupportedCapabilityResult(mutate), true);

    const graph = await adapter.graphTraversal("frame-001");
    assert.equal(isUnsupportedCapabilityResult(graph), true);

    const profile = await adapter.readProfileSlot("active_intent");
    assert.equal(isUnsupportedCapabilityResult(profile), true);

    const registry = await adapter.listProceduralRegistry();
    assert.equal(isUnsupportedCapabilityResult(registry), true);

    const tx = await adapter.transactionBegin();
    assert.equal(tx.success, false);
    if (tx.success) return;
    assert.equal(tx.error.code, AmpErrorCode.CAPABILITY_NOT_SUPPORTED);
  });
});

describe("frame-codec", () => {
  it("round-trips frame through markdown frontmatter", async () => {
    const fake = new FakeGbrainMcpTransport();
    const adapter = new GbrainKnowledgeAdapter({ transport: fake, ssaSpecPath: GBRAIN_SPEC });

    await adapter.writeFrames([SAMPLE_FRAME]);
    const slug = frameIdToSlug("frame-001");
    const markdown = fake.getPageContent(slug);
    assert.ok(markdown);
    const decoded = decodePageContentToFrame(markdown);
    assert.equal(decoded.success, true);
    if (!decoded.success) return;
    assert.equal(decoded.frame.id, "frame-001");
  });

  it("does not collapse distinct frame ids into the same gbrain slug", () => {
    assert.notEqual(frameIdToSlug("a/b"), frameIdToSlug("a b"));
    assert.notEqual(frameIdToSlug(""), frameIdToSlug("???"));
  });
});

describe("GbrainServeStdioTransport", () => {
  it("defaults to gbrain serve stdio MCP command shape", () => {
    const transport = new GbrainServeStdioTransport();
    assert.ok(transport);
    assert.equal(typeof transport.callTool, "function");
  });
});

describe("extractSearchHitRefs", () => {
  it("parses results arrays with slug and score", () => {
    const hits = extractSearchHitRefs({
      results: [
        { slug: "amp/frames/abc", score: 0.92 },
        { slug: "other/page", score: 0.5 },
      ],
    });
    assert.deepEqual(hits, [
      { slug: "amp/frames/abc", score: 0.92 },
      { slug: "other/page", score: 0.5 },
    ]);
  });
});

describe("unsupportedSearchResult parity", () => {
  it("search helper uses CAPABILITY_NOT_SUPPORTED", () => {
    const result = unsupportedSearchResult("search");
    assert.equal(isUnsupportedCapabilityResult(result), true);
  });
});
