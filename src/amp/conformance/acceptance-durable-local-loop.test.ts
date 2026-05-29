import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
  DURABLE_LOCAL_LOOP_CAPTURE_TEXT,
  runDurableLocalLoopAcceptanceStep,
} from "./acceptance-durable-local-loop.js";

describe("runDurableLocalLoopAcceptanceStep", () => {
  it("passes the offline durable local knowledge loop", async () => {
    const result = await runDurableLocalLoopAcceptanceStep();
    assert.equal(result.step, DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP);
    assert.equal(result.passed, true, result.detail);
    assert.equal(result.detail, undefined);
  });

  it("uses deterministic capture text", () => {
    assert.match(DURABLE_LOCAL_LOOP_CAPTURE_TEXT, /typecheck before every AMP commit/);
  });
});
