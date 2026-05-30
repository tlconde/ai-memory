/**
 * gbrain SSA capability honesty conformance (INV-2).
 *
 * PROVISIONAL: exercises fake MCP transport parity only; live `gbrain serve` not in CI.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isCapabilitySupported } from "../adapter-contract/capability-coverage.js";
import {
  isUnsupportedCapabilityResult,
} from "../adapter-contract/unsupported-capability.js";
import { AmpErrorCode } from "../core/errors.js";
import { createFrame } from "../core/frame-schema.js";
import { loadSsaSpecFromFile } from "../ssa/loader.js";
import { FakeGbrainMcpTransport } from "../adapters/ssa/gbrain/fake-transport.js";
import { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const GBRAIN_SPEC = join(REPO_ROOT, "ssa-files/gbrain.yaml");

describe("gbrain capability honesty conformance", () => {
  it("declares graph_traversal wrapped with honest adapter surfaces", async () => {
    const spec = loadSsaSpecFromFile(GBRAIN_SPEC);
    assert.equal(spec.capability_coverage.graph_traversal, "wrapped");
    assert.equal(isCapabilitySupported(spec.capability_coverage, "graph_traversal"), true);

    const adapter = new GbrainKnowledgeAdapter({
      transport: new FakeGbrainMcpTransport(),
      ssaSpecPath: GBRAIN_SPEC,
    });

    const graphSearch = await adapter.searchFrames("anything", { mode: "graph" });
    assert.equal(isUnsupportedCapabilityResult(graphSearch), true);
    if (graphSearch.success) return;
    assert.equal(graphSearch.error.code, AmpErrorCode.CAPABILITY_NOT_SUPPORTED);

    const graphTraversal = await adapter.graphTraversal("frame-001");
    assert.equal(isUnsupportedCapabilityResult(graphTraversal), false);
  });

  it("supports keyword search via MCP search when full_text_search is wrapped", async () => {
    const spec = loadSsaSpecFromFile(GBRAIN_SPEC);
    assert.equal(isCapabilitySupported(spec.capability_coverage, "full_text_search"), true);

    const fake = new FakeGbrainMcpTransport();
    const adapter = new GbrainKnowledgeAdapter({ transport: fake, ssaSpecPath: GBRAIN_SPEC });
    const frame = createFrame({
      id: "conformance-search-001",
      kind: "semantic",
      content: "Conformance keyword probe.",
      source: { surface: "cursor" },
      created_at: "2026-05-25T12:00:00.000Z",
      scope: { kind: "project", project_ref: "ai-memory" },
      curation_mode: "personal",
    });
    await adapter.writeFrames([frame]);

    const search = await adapter.searchFrames("Conformance keyword", { mode: "keyword" });
    assert.equal(search.success, true);
    if (!search.success) return;
    assert.equal(search.hits.length, 1);
    assert.equal(search.hits[0]?.item.id, "conformance-search-001");
  });

  it("supports hybrid search via MCP query when vector and full_text are wrapped", async () => {
    const spec = loadSsaSpecFromFile(GBRAIN_SPEC);
    assert.equal(isCapabilitySupported(spec.capability_coverage, "vector_search"), true);
    assert.equal(isCapabilitySupported(spec.capability_coverage, "full_text_search"), true);

    const fake = new FakeGbrainMcpTransport();
    const adapter = new GbrainKnowledgeAdapter({ transport: fake, ssaSpecPath: GBRAIN_SPEC });
    const frame = createFrame({
      id: "conformance-hybrid-001",
      kind: "semantic",
      content: "Hybrid conformance probe.",
      source: { surface: "cursor" },
      created_at: "2026-05-25T12:00:00.000Z",
      scope: { kind: "project", project_ref: "ai-memory" },
      curation_mode: "personal",
    });
    await adapter.writeFrames([frame]);

    const search = await adapter.searchFrames("Hybrid conformance", { mode: "hybrid" });
    assert.equal(search.success, true);
    if (!search.success) return;
    assert.equal(search.hits[0]?.item.id, "conformance-hybrid-001");
  });

  it("declares procedural_registry wrapped while MCP listProceduralRegistry stays unsupported", async () => {
    const spec = loadSsaSpecFromFile(GBRAIN_SPEC);
    assert.equal(spec.capability_coverage.procedural_registry, "wrapped");
    assert.equal(isCapabilitySupported(spec.capability_coverage, "procedural_registry"), true);

    const adapter = new GbrainKnowledgeAdapter({
      transport: new FakeGbrainMcpTransport(),
      ssaSpecPath: GBRAIN_SPEC,
    });

    const registry = await adapter.listProceduralRegistry();
    assert.equal(isUnsupportedCapabilityResult(registry), true);
  });

  it("returns CAPABILITY_NOT_SUPPORTED for transactions", async () => {
    const adapter = new GbrainKnowledgeAdapter({
      transport: new FakeGbrainMcpTransport(),
      ssaSpecPath: GBRAIN_SPEC,
    });

    const tx = await adapter.transactionBegin();
    assert.equal(tx.success, false);
    if (tx.success) return;
    assert.equal(tx.error.code, AmpErrorCode.CAPABILITY_NOT_SUPPORTED);
  });
});
