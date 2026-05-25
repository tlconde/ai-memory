import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { frameIdToSlug } from "../adapters/ssa/gbrain/frame-codec.js";
import {
  AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV,
  AMP_LIVE_FRAME_ID_PREFIX,
  AMP_LIVE_SLUG_PREFIX,
  assertLiveGbrainWriteConfirmed,
  confirmLiveGbrainWriteFromCliOptions,
  formatResidualPageWarning,
  interpretDeletePageCleanup,
  isAmpOwnedLiveFrameId,
  isLiveGbrainWriteConfirmed,
} from "./live-policy.js";

describe("live gbrain write confirmation", () => {
  it("requires explicit flag or env", () => {
    assert.equal(isLiveGbrainWriteConfirmed({ env: {} }), false);
    assert.throws(() => assertLiveGbrainWriteConfirmed({ env: {} }), /Live gbrain writes are disabled/);
  });

  it("accepts --confirm-live-gbrain-write flag", () => {
    assert.equal(isLiveGbrainWriteConfirmed({ confirmLiveGbrainWrite: true, env: {} }), true);
    assert.doesNotThrow(() =>
      assertLiveGbrainWriteConfirmed({ confirmLiveGbrainWrite: true, env: {} })
    );
  });

  it("accepts AMP_CONFIRM_LIVE_GBRAIN_WRITE=1", () => {
    assert.equal(
      isLiveGbrainWriteConfirmed({ env: { [AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV]: "1" } }),
      true
    );
  });

  it("maps deprecated --live-gbrain alias at CLI boundary only", () => {
    assert.equal(
      confirmLiveGbrainWriteFromCliOptions({ deprecatedLiveGbrainAlias: true }),
      true
    );
    assert.equal(
      confirmLiveGbrainWriteFromCliOptions({ confirmLiveGbrainWrite: true }),
      true
    );
    assert.equal(confirmLiveGbrainWriteFromCliOptions({}), false);
  });

  it("error message suggests safe backends", () => {
    assert.throws(
      () => assertLiveGbrainWriteConfirmed({ env: {} }),
      /--knowledge in-memory/
    );
  });
});

describe("live gbrain cleanup helpers", () => {
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
