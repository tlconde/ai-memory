import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AmpErrorCode } from "../core/errors.js";
import { createSliceCapabilityCoverage } from "./capability-coverage.js";
import {
  assertCapabilitySupported,
  checkCapabilityOrError,
  isUnsupportedCapabilityResult,
  unsupportedCapabilityError,
  unsupportedReadResult,
  unsupportedSearchResult,
  unsupportedWriteResult,
} from "./unsupported-capability.js";

describe("unsupportedCapabilityError", () => {
  it("returns CAPABILITY_NOT_SUPPORTED AmpError", () => {
    const err = unsupportedCapabilityError("vector_search");
    assert.equal(err.code, AmpErrorCode.CAPABILITY_NOT_SUPPORTED);
    assert.match(err.message, /vector_search/);
    assert.equal(err.retriable, false);
  });
});

describe("checkCapabilityOrError", () => {
  it("returns undefined when capability is supported", () => {
    const coverage = createSliceCapabilityCoverage();
    assert.equal(checkCapabilityOrError(coverage, "curation_mode"), undefined);
  });

  it("returns AmpError when capability is unsupported", () => {
    const coverage = createSliceCapabilityCoverage();
    const err = checkCapabilityOrError(coverage, "vector_search");
    assert.ok(err);
    assert.equal(err.code, AmpErrorCode.CAPABILITY_NOT_SUPPORTED);
  });
});

describe("assertCapabilitySupported", () => {
  it("does not throw for supported capabilities", () => {
    const coverage = createSliceCapabilityCoverage();
    assert.doesNotThrow(() => assertCapabilitySupported(coverage, "curation_mode"));
  });

  it("throws for unsupported capabilities", () => {
    const coverage = createSliceCapabilityCoverage();
    assert.throws(
      () => assertCapabilitySupported(coverage, "vector_search"),
      (err: unknown) =>
        err instanceof Error &&
        "code" in err &&
        (err as { code: number }).code === AmpErrorCode.CAPABILITY_NOT_SUPPORTED
    );
  });
});

describe("unsupported operation result helpers", () => {
  it("unsupportedReadResult is detectable", () => {
    const result = unsupportedReadResult("embedding_storage");
    assert.equal(isUnsupportedCapabilityResult(result), true);
    assert.equal(result.success, false);
  });

  it("unsupportedWriteResult is detectable", () => {
    const result = unsupportedWriteResult("procedural_registry");
    assert.equal(isUnsupportedCapabilityResult(result), true);
  });

  it("unsupportedSearchResult is detectable", () => {
    const result = unsupportedSearchResult("graph_traversal");
    assert.equal(isUnsupportedCapabilityResult(result), true);
  });
});
