import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createFrame } from "../../core/frame-schema.js";
import { InMemoryKnowledgeStore } from "./in-memory-knowledge-store.js";

const SAMPLE_FRAME = createFrame({
  id: "frame-001",
  kind: "semantic",
  content: "Prefer 2-space indentation.",
  source: { surface: "cursor" },
  created_at: "2026-05-24T12:00:00.000Z",
  scope: { kind: "project", project_ref: "ai-memory" },
  curation_mode: "personal",
});

describe("InMemoryKnowledgeStore", () => {
  it("writes and reads a frame by id", () => {
    const store = new InMemoryKnowledgeStore();
    store.write([SAMPLE_FRAME]);
    const read = store.read("frame-001");
    assert.equal(read?.content, "Prefer 2-space indentation.");
  });

  it("lists frames by project scope", () => {
    const store = new InMemoryKnowledgeStore();
    store.write([SAMPLE_FRAME]);
    const results = store.list({ scopeKind: "project", projectRef: "ai-memory" });
    assert.equal(results.length, 1);
  });

  it("reports unsupported vector_search in capabilities", () => {
    const store = new InMemoryKnowledgeStore();
    assert.equal(store.capabilities().vector_search, "unsupported");
  });
});
