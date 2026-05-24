import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createSliceCapabilityCoverage } from "../adapter-contract/capability-coverage.js";
import { ExternalClaimLabelSchema } from "./claim-label.js";
import { parseSsaSpec } from "./schema.js";

describe("ExternalClaimLabelSchema", () => {
  it("accepts VERIFIED, PROVISIONAL, and UNKNOWN", () => {
    for (const label of ["VERIFIED", "PROVISIONAL", "UNKNOWN"] as const) {
      assert.equal(ExternalClaimLabelSchema.safeParse(label).success, true);
    }
  });

  it("rejects invalid claim labels", () => {
    assert.equal(ExternalClaimLabelSchema.safeParse("GUESS").success, false);
  });
});

describe("parseSsaSpec", () => {
  it("accepts a valid substrate spec with capability_coverage", () => {
    const result = parseSsaSpec({
      id: "test-ssa",
      name: "Test SSA",
      version: "0.1.0",
      role: "substrate",
      capability_coverage: createSliceCapabilityCoverage(),
    });
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.equal(result.spec.role, "substrate");
    assert.equal(result.spec.capability_coverage.vector_search, "unsupported");
  });

  it("rejects non-substrate role", () => {
    const result = parseSsaSpec({
      id: "bad",
      name: "Bad",
      version: "0.1.0",
      role: "surface",
      capability_coverage: createSliceCapabilityCoverage(),
    });
    assert.equal(result.success, false);
  });

  it("rejects invalid capability_coverage via shared parser", () => {
    const result = parseSsaSpec({
      id: "bad-cov",
      name: "Bad Cov",
      version: "0.1.0",
      role: "substrate",
      capability_coverage: { curation_mode: "native" },
    });
    assert.equal(result.success, false);
    if (result.success) return;
    assert.match(result.error, /frame_kinds|capability/i);
  });

  it("rejects unknown top-level keys", () => {
    const result = parseSsaSpec({
      id: "strict",
      name: "Strict",
      version: "0.1.0",
      role: "substrate",
      capability_coverage: createSliceCapabilityCoverage(),
      extra: true,
    });
    assert.equal(result.success, false);
  });

  it("accepts optional external_claims with labeled claims", () => {
    const result = parseSsaSpec({
      id: "claims",
      name: "Claims",
      version: "0.1.0",
      role: "substrate",
      capability_coverage: createSliceCapabilityCoverage(),
      external_claims: [
        {
          claim: "Vector search is unsupported in the slice backend",
          label: "VERIFIED",
        },
      ],
    });
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.equal(result.spec.external_claims?.[0]?.label, "VERIFIED");
  });

  it("rejects external_claims with invalid label", () => {
    const result = parseSsaSpec({
      id: "bad-label",
      name: "Bad Label",
      version: "0.1.0",
      role: "substrate",
      capability_coverage: createSliceCapabilityCoverage(),
      external_claims: [{ claim: "Unlabeled behavior", label: "SPECULATIVE" }],
    });
    assert.equal(result.success, false);
  });
});
