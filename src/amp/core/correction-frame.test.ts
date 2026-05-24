import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CORRECTION_FRAME_CONTENT_TYPE,
  createCorrectionFrame,
  isCorrectionFrame,
  parseCorrectionFrameContent,
  readCorrectionFrameContent,
  validateCorrectionFrame,
} from "./correction-frame.js";
import { createFrame, frameRoundTripPreserves } from "./frame-schema.js";

const CORRECTION_INPUT = {
  id: "corr-001",
  correctionOfFrameId: "frame-semantic-001",
  classifier: "kind_classifier",
  previousOutput: "semantic",
  correctedOutput: "episodic",
  contextFingerprint: "content-hash:abc123",
  scope: { kind: "user" as const },
  source: { surface: "cursor", harness: "cursor", captured_at: "2026-05-25T10:00:00.000Z" },
  createdAt: "2026-05-25T10:05:00.000Z",
  correctionReason: "User corrected kind classification",
};

describe("createCorrectionFrame", () => {
  it("creates an episodic frame with correction_of and typed content", () => {
    const frame = createCorrectionFrame(CORRECTION_INPUT);

    assert.equal(frame.kind, "episodic");
    assert.equal(frame.correction_of, "frame-semantic-001");
    assert.equal(isCorrectionFrame(frame), true);

    const content = readCorrectionFrameContent(frame);
    assert.equal(content?.type, CORRECTION_FRAME_CONTENT_TYPE);
    assert.equal(content?.classifier, "kind_classifier");
    assert.equal(content?.previous_output, "semantic");
    assert.equal(content?.corrected_output, "episodic");
    assert.equal(content?.context_fingerprint, "content-hash:abc123");
  });

  it("round-trips through frame wire serialization", () => {
    const frame = createCorrectionFrame(CORRECTION_INPUT);
    assert.equal(frameRoundTripPreserves(frame), true);
    assert.equal(validateCorrectionFrame(frame), true);
  });

  it("rejects malformed correction content", () => {
    const parsed = parseCorrectionFrameContent({
      type: CORRECTION_FRAME_CONTENT_TYPE,
      classifier: "kind_classifier",
    });
    assert.equal(parsed.success, false);
  });

  it("returns false for non-correction episodic frames", () => {
    const frame = createFrame({
      id: "ep-1",
      kind: "episodic",
      content: { note: "plain episodic event" },
      source: { surface: "cursor" },
      created_at: "2026-05-25T10:00:00.000Z",
      scope: { kind: "user" },
      curation_mode: "personal",
    });
    assert.equal(isCorrectionFrame(frame), false);
  });
});
