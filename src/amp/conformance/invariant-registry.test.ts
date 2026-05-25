import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  INVARIANT_IDS,
  INVARIANT_TEST_REGISTRY,
  invariantIdsForTestFile,
  listInvariantCoverage,
} from "./invariant-registry.js";

describe("invariant registry", () => {
  it("registers INV-1 through INV-6", () => {
    const ids = listInvariantCoverage().map((entry) => entry.invariantId);
    assert.deepEqual(ids, [
      INVARIANT_IDS.INV_1_SCOPE_NEVER_INFERRED,
      INVARIANT_IDS.INV_2_INJECTABILITY_HONEST,
      INVARIANT_IDS.INV_3_CLOUD_BOUNDED,
      INVARIANT_IDS.INV_4_FROM_AMP_ISOLATED,
      INVARIANT_IDS.INV_5_FALSIFIABLE_CLAIMS,
      INVARIANT_IDS.INV_6_LOCAL_GITIGNORE,
    ]);
  });

  it("maps scope gate tests to INV-1", () => {
    assert.deepEqual(invariantIdsForTestFile("src/amp/core/scope-gate.test.ts"), [
      INVARIANT_IDS.INV_1_SCOPE_NEVER_INFERRED,
    ]);
  });

  it("maps E2E slice test to INV-5", () => {
    assert.deepEqual(invariantIdsForTestFile("src/amp/integration/preference-vertical-slice.test.ts"), [
      INVARIANT_IDS.INV_5_FALSIFIABLE_CLAIMS,
    ]);
  });

  it("maps git status integration test to INV-6", () => {
    assert.deepEqual(invariantIdsForTestFile("src/amp/integration/invariant-6-git-status.test.ts"), [
      INVARIANT_IDS.INV_6_LOCAL_GITIGNORE,
    ]);
  });

  it("documents INV-3 as deferred with no slice tests", () => {
    const inv3 = INVARIANT_TEST_REGISTRY.find(
      (entry) => entry.invariantId === INVARIANT_IDS.INV_3_CLOUD_BOUNDED
    );
    assert.ok(inv3);
    assert.equal(inv3!.testFiles.length, 0);
  });
});
