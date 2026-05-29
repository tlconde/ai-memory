import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createSliceCapabilityCoverage,
  isCapabilitySupported,
  meetsMinimalCompliance,
  parseCapabilityCoverage,
} from "./capability-coverage.js";

describe("parseCapabilityCoverage", () => {
  it("accepts a valid coverage block", () => {
    const result = parseCapabilityCoverage(createSliceCapabilityCoverage());
    assert.equal(result.success, true);
  });

  it("rejects missing frame_kinds", () => {
    const result = parseCapabilityCoverage({
      curation_mode: "native",
    });
    assert.equal(result.success, false);
  });

  it("rejects coverage missing skill_optimization", () => {
    const base = createSliceCapabilityCoverage();
    const { skill_optimization: _removed, ...withoutSkillOptimization } = base;
    const result = parseCapabilityCoverage(withoutSkillOptimization);
    assert.equal(result.success, false);
  });

  it("rejects coverage missing action_log", () => {
    const base = createSliceCapabilityCoverage();
    const { action_log: _removed, ...withoutActionLog } = base;
    const result = parseCapabilityCoverage(withoutActionLog);
    assert.equal(result.success, false);
  });
});

describe("capability honesty", () => {
  it("reports vector_search unsupported in slice default coverage", () => {
    const coverage = createSliceCapabilityCoverage();
    assert.equal(isCapabilitySupported(coverage, "vector_search"), false);
    assert.equal(coverage.vector_search, "unsupported");
  });

  it("reports skill_optimization unsupported in slice default coverage", () => {
    const coverage = createSliceCapabilityCoverage();
    assert.equal(isCapabilitySupported(coverage, "skill_optimization"), false);
    assert.equal(coverage.skill_optimization, "unsupported");
  });

  it("meets minimal compliance for slice default coverage", () => {
    const coverage = createSliceCapabilityCoverage();
    assert.equal(meetsMinimalCompliance(coverage), true);
  });

  it("fails minimal compliance when curation_mode is unsupported", () => {
    const coverage = createSliceCapabilityCoverage({ curation_mode: "unsupported" });
    assert.equal(meetsMinimalCompliance(coverage), false);
  });
});
