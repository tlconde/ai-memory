import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FRAME_SCHEMA_VERSION,
  createFrame,
  frameRoundTripPreserves,
  parseFrame,
  serializeFrame,
} from "./frame-schema.js";

const BASE_FRAME = {
  id: "frame-001",
  kind: "semantic" as const,
  content: "Prefer tabs over spaces in this project.",
  source: {
    surface: "cursor",
    harness: "cursor",
    captured_at: "2026-05-24T12:00:00.000Z",
  },
  created_at: "2026-05-24T12:00:00.000Z",
  scope: {
    kind: "project" as const,
    project_ref: "ai-memory",
  },
  curation_mode: "personal" as const,
};

describe("parseFrame", () => {
  it("accepts a valid project-scoped semantic frame", () => {
    const result = parseFrame(BASE_FRAME);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.frame.kind, "semantic");
      assert.equal(result.frame.scope.kind, "project");
      assert.equal(result.frame.scope.project_ref, "ai-memory");
      assert.equal(result.frame.curation_mode, "personal");
    }
  });

  it("rejects project scope without project_ref", () => {
    const result = parseFrame({
      ...BASE_FRAME,
      scope: { kind: "project" },
    });
    assert.equal(result.success, false);
  });

  it("rejects correction_of on non-episodic frames", () => {
    const result = parseFrame({
      ...BASE_FRAME,
      correction_of: "frame-other",
    });
    assert.equal(result.success, false);
  });
});

describe("frame round-trip", () => {
  it("preserves kind, scope, curation_mode, provenance, and schema version", () => {
    const frame = createFrame(BASE_FRAME);
    assert.equal(frame.schema_version, FRAME_SCHEMA_VERSION);
    assert.equal(frameRoundTripPreserves(frame), true);

    const wire = serializeFrame(frame);
    const reparsed = parseFrame(wire);
    assert.equal(reparsed.success, true);
    if (reparsed.success) {
      assert.equal(reparsed.frame.kind, "semantic");
      assert.equal(reparsed.frame.scope.kind, "project");
      assert.equal(reparsed.frame.curation_mode, "personal");
      assert.equal(reparsed.frame.source.surface, "cursor");
      assert.equal(reparsed.frame.schema_version, FRAME_SCHEMA_VERSION);
    }
  });

  it("preserves optional kind_provenance through round-trip", () => {
    const frame = createFrame({
      ...BASE_FRAME,
      kind_provenance: {
        default_inferred: "semantic",
        default_basis: "rule:preference-keyword",
        user_override: null,
        override_reason: null,
        final_kind_source: "default",
      },
    });
    assert.equal(frameRoundTripPreserves(frame), true);
  });
});
