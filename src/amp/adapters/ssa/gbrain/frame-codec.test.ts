import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import {
  AMP_FRAME_SLUG_PREFIX,
  frameIdToSlug,
  isAmpFrameSlug,
} from "./frame-codec.js";

/** Expected slug for a frame id — mirrors the locked `h.{hex}` contract. */
function expectedSlug(frameId: string): string {
  const hex = Buffer.from(frameId, "utf8").toString("hex");
  return `${AMP_FRAME_SLUG_PREFIX}h.${hex}`;
}

/** Legacy base64url final segment (pre V1-LIVE-01); must differ from current slugs. */
function legacyBase64UrlSlug(frameId: string): string {
  const encoded = Buffer.from(frameId, "utf8").toString("base64url");
  return `${AMP_FRAME_SLUG_PREFIX}${encoded}`;
}

describe("frameIdToSlug slug encoding contract", () => {
  it("encodes frame-001 as amp/frames/h.{hex}", () => {
    assert.equal(frameIdToSlug("frame-001"), expectedSlug("frame-001"));
    assert.equal(frameIdToSlug("frame-001"), "amp/frames/h.6672616d652d303031");
  });

  it("encodes live-v1 probe ids as amp/frames/h.{hex}", () => {
    const liveId = "live-v1-1716652800000-a1b2c3";
    assert.equal(frameIdToSlug(liveId), expectedSlug(liveId));
    assert.match(frameIdToSlug(liveId), /^amp\/frames\/h\.[0-9a-f]+$/);
  });

  it("uses lowercase hex only in the final segment", () => {
    const slug = frameIdToSlug("Frame-UPPER");
    const hexSegment = slug.slice(`${AMP_FRAME_SLUG_PREFIX}h.`.length);
    assert.match(hexSegment, /^[0-9a-f]+$/);
    assert.doesNotMatch(hexSegment, /[A-F]/);
  });

  it("does not collapse distinct frame ids into the same slug", () => {
    assert.notEqual(frameIdToSlug("a/b"), frameIdToSlug("a b"));
    assert.notEqual(frameIdToSlug(""), frameIdToSlug("???"));
    assert.notEqual(frameIdToSlug("frame-001"), frameIdToSlug("frame-002"));
  });

  it("differs from legacy base64url slugs for the same frame id", () => {
    const ids = ["frame-001", "live-v1-probe", "a/b", ""];
    for (const id of ids) {
      assert.notEqual(frameIdToSlug(id), legacyBase64UrlSlug(id));
    }
  });

  it("final segment is not bare base64url (gbrain slug lookup collision)", () => {
    const slug = frameIdToSlug("frame-001");
    const finalSegment = slug.slice(AMP_FRAME_SLUG_PREFIX.length);
    assert.ok(finalSegment.startsWith("h."));
    // Bare base64url segments omit the h. prefix gbrain mis-resolves.
    assert.notEqual(finalSegment, Buffer.from("frame-001", "utf8").toString("base64url"));
  });
});

describe("isAmpFrameSlug", () => {
  it("matches amp/frames/ prefix including h.{hex} slugs", () => {
    assert.equal(isAmpFrameSlug(frameIdToSlug("frame-001")), true);
    assert.equal(isAmpFrameSlug("amp/frames/h.deadbeef"), true);
    assert.equal(isAmpFrameSlug("other/page"), false);
    assert.equal(isAmpFrameSlug("amp/other/frame"), false);
  });
});
