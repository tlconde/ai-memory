import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV,
  assertLiveGbrainWriteConfirmed,
  isLiveGbrainWriteConfirmed,
} from "./live-gbrain-safety.js";

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

  it("error message suggests safe backends", () => {
    assert.throws(
      () => assertLiveGbrainWriteConfirmed({ env: {} }),
      /--knowledge in-memory/
    );
  });
});
