import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AmpError,
  AmpErrorCode,
  capabilityNotSupported,
  defaultRetriable,
  frameSchemaMismatch,
  isJsonRpcErrorResponse,
} from "./errors.js";

describe("AmpError JSON-RPC envelope", () => {
  it("serializes to JSON-RPC 2.0 error response", () => {
    const err = frameSchemaMismatch({ field: "scope.project_ref" });
    const rpc = err.toJsonRpc("req-1");

    assert.equal(rpc.jsonrpc, "2.0");
    assert.equal(rpc.id, "req-1");
    assert.equal(rpc.error.code, AmpErrorCode.FRAME_SCHEMA_MISMATCH);
    assert.match(rpc.error.message, /schema validation/i);
    assert.deepEqual(rpc.error.data, { field: "scope.project_ref" });
    assert.equal(isJsonRpcErrorResponse(rpc), true);
  });

  it("marks capability-not-supported as non-retriable", () => {
    const err = capabilityNotSupported("vector_search");
    assert.equal(err.code, AmpErrorCode.CAPABILITY_NOT_SUPPORTED);
    assert.equal(err.retriable, false);
    assert.equal(defaultRetriable(AmpErrorCode.CAPABILITY_NOT_SUPPORTED), false);
  });

  it("defaults substrate offline to retriable", () => {
    const err = new AmpError({
      code: AmpErrorCode.SUBSTRATE_OFFLINE,
      message: "substrate unavailable",
    });
    assert.equal(err.retriable, true);
  });
});

describe("AmpErrorCode coverage", () => {
  it("defines -32001 through -32010", () => {
    const codes = Object.values(AmpErrorCode);
    assert.equal(codes.length, 10);
    assert.equal(Math.min(...codes), -32010);
    assert.equal(Math.max(...codes), -32001);
  });
});
