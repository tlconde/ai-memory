import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV,
  assertLiveGbrainWriteConfirmed,
  confirmLiveGbrainWriteFromCliOptions,
  formatResidualPageWarning,
  interpretDeletePageCleanup,
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
  it("treats soft_deleted and deleted as cleanup success (PROVISIONAL)", () => {
    assert.deepEqual(interpretDeletePageCleanup({ status: "soft_deleted" }), {
      cleanupSucceeded: true,
      deleteStatus: "soft_deleted",
    });
  });

  it("formatResidualPageWarning includes slug guidance", () => {
    const warning = formatResidualPageWarning({
      slug: "amp/frames/h.deadbeef",
      frameId: "live-v1-x",
      cleanupAttempted: true,
      cleanupSucceeded: false,
    });
    assert.match(warning, /slug: amp\/frames\/h.deadbeef/);
  });
});
