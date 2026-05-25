import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AMP_LIVE_FRAME_ID_PREFIX,
  AMP_LIVE_SLUG_PREFIX,
  formatResidualPageWarning,
  interpretDeletePageCleanup,
  isAmpOwnedLiveFrameId,
} from "./gbrain-live-safety.js";
import { frameIdToSlug } from "../adapters/ssa/gbrain/frame-codec.js";

describe("gbrain live test safety helpers", () => {
  it("recognizes AMP-owned live frame ids", () => {
    assert.equal(isAmpOwnedLiveFrameId(`${AMP_LIVE_FRAME_ID_PREFIX}abc`), true);
    assert.equal(isAmpOwnedLiveFrameId("frame-001"), false);
  });

  it("maps live frame ids to amp/frames/h.{hex} slugs", () => {
    const frameId = `${AMP_LIVE_FRAME_ID_PREFIX}probe`;
    const slug = frameIdToSlug(frameId);
    assert.match(slug, new RegExp(`^${AMP_LIVE_SLUG_PREFIX}[0-9a-f]+$`));
  });

  it("treats soft_deleted and deleted as cleanup success (PROVISIONAL)", () => {
    assert.deepEqual(interpretDeletePageCleanup({ status: "soft_deleted" }), {
      cleanupSucceeded: true,
      deleteStatus: "soft_deleted",
    });
    assert.deepEqual(interpretDeletePageCleanup({ status: "deleted" }), {
      cleanupSucceeded: true,
      deleteStatus: "deleted",
    });
  });

  it("reports failure when delete status is missing or unknown", () => {
    assert.deepEqual(interpretDeletePageCleanup({ status: "missing" }), {
      cleanupSucceeded: false,
      deleteStatus: "missing",
    });
    assert.deepEqual(interpretDeletePageCleanup(null), {
      cleanupSucceeded: false,
      deleteStatus: undefined,
    });
  });

  it("formatResidualPageWarning includes slug and soft-delete guidance", () => {
    const warning = formatResidualPageWarning({
      slug: "amp/frames/h.deadbeef",
      frameId: `${AMP_LIVE_FRAME_ID_PREFIX}x`,
      cleanupAttempted: true,
      cleanupSucceeded: false,
      deleteStatus: "error",
    });

    assert.match(warning, /slug: amp\/frames\/h.deadbeef/);
    assert.match(warning, /soft-delete/);
    assert.match(warning, /does not auto-delete/);
  });
});
