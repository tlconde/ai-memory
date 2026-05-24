import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  INVARIANT_IDS,
  INVARIANT_TEST_REGISTRY,
} from "./invariant-registry.js";
import {
  discoverMappedTestFiles,
  formatConformanceReport,
  invariantIdsFromTargets,
  resolveConformanceTargets,
  runConformance,
  type TestBatchResult,
} from "./conformance-runner.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function mockExecutor(exitCode: number) {
  return async (testFiles: string[], _projectRoot: string): Promise<TestBatchResult> => ({
    testFiles,
    exitCode,
    stdout: "",
    stderr: "",
  });
}

describe("conformance runner", () => {
  it("discovers all invariant suites from the registry", () => {
    const targets = resolveConformanceTargets();
    assert.equal(targets.length, INVARIANT_TEST_REGISTRY.length);
    assert.deepEqual(invariantIdsFromTargets(targets), [
      INVARIANT_IDS.INV_1_SCOPE_NEVER_INFERRED,
      INVARIANT_IDS.INV_2_INJECTABILITY_HONEST,
      INVARIANT_IDS.INV_3_CLOUD_BOUNDED,
      INVARIANT_IDS.INV_4_FROM_AMP_ISOLATED,
      INVARIANT_IDS.INV_5_FALSIFIABLE_CLAIMS,
    ]);
  });

  it("filters targets by invariant ID", () => {
    const targets = resolveConformanceTargets({
      invariantIds: [INVARIANT_IDS.INV_4_FROM_AMP_ISOLATED],
    });
    assert.equal(targets.length, 1);
    assert.equal(targets[0]!.invariantId, INVARIANT_IDS.INV_4_FROM_AMP_ISOLATED);
    assert.equal(targets[0]!.testFiles.length, 3);
  });

  it("filters targets by adapter test file pattern", () => {
    const targets = resolveConformanceTargets({
      testFilePattern: "**/adapters/sas/cursor/**",
    });
    assert.equal(targets.length, 1);
    assert.deepEqual(targets[0]!.testFiles, [
      "src/amp/adapters/sas/cursor/adapter.test.ts",
    ]);
  });

  it("excludes deferred INV-3 when filtering by unrelated test pattern", () => {
    const targets = resolveConformanceTargets({
      testFilePattern: "**/adapters/sas/cursor/**",
    });
    assert.ok(targets.every((target) => target.invariantId !== INVARIANT_IDS.INV_3_CLOUD_BOUNDED));
  });

  it("discovers mapped test files for a filtered suite", () => {
    const files = discoverMappedTestFiles({
      testFilePattern: "**/path-safety/**",
    });
    assert.deepEqual(files, ["src/amp/path-safety/guard.test.ts"]);
  });

  it("reports INV-3 as deferred with missing coverage", async () => {
    const report = await runConformance({
      invariantIds: [INVARIANT_IDS.INV_3_CLOUD_BOUNDED],
      executeTests: async () => {
        throw new Error("deferred invariants must not execute tests");
      },
    });

    assert.equal(report.results.length, 1);
    assert.equal(report.results[0]!.status, "deferred");
    assert.match(report.results[0]!.message ?? "", /Missing automated coverage/i);
    assert.equal(report.results[0]!.testFiles.length, 0);
    assert.equal(report.allPassed, true);
  });

  it("includes deferred INV-3 in full-suite discovery", () => {
    const targets = resolveConformanceTargets();
    const inv3 = targets.find((target) => target.invariantId === INVARIANT_IDS.INV_3_CLOUD_BOUNDED);
    assert.ok(inv3);
    assert.equal(inv3!.deferred, true);
    assert.equal(inv3!.testFiles.length, 0);
  });

  it("marks invariant pass when mapped tests succeed", async () => {
    const report = await runConformance({
      invariantIds: [INVARIANT_IDS.INV_1_SCOPE_NEVER_INFERRED],
      executeTests: mockExecutor(0),
    });

    assert.equal(report.results.length, 1);
    assert.equal(report.results[0]!.status, "pass");
    assert.deepEqual(report.results[0]!.testFiles, ["src/amp/core/scope-gate.test.ts"]);
    assert.equal(report.allPassed, true);
  });

  it("marks invariant fail when mapped tests fail", async () => {
    const report = await runConformance({
      invariantIds: [INVARIANT_IDS.INV_2_INJECTABILITY_HONEST],
      executeTests: mockExecutor(1),
    });

    assert.equal(report.results.length, 1);
    assert.equal(report.results[0]!.status, "fail");
    assert.match(report.results[0]!.message ?? "", /exited with code 1/);
    assert.equal(report.allPassed, false);
  });

  it("formats pass/fail/deferred lines per invariant ID", async () => {
    const report = await runConformance({
      invariantIds: [
        INVARIANT_IDS.INV_1_SCOPE_NEVER_INFERRED,
        INVARIANT_IDS.INV_3_CLOUD_BOUNDED,
      ],
      executeTests: mockExecutor(0),
    });

    const formatted = formatConformanceReport(report);
    assert.match(formatted, /^PASS INV-1/m);
    assert.match(formatted, /^DEFERRED INV-3/m);
    assert.match(formatted, /Overall: PASS$/m);
  });

  it("runs mapped scope-gate tests via default executor", async () => {
    const report = await runConformance({
      invariantIds: [INVARIANT_IDS.INV_1_SCOPE_NEVER_INFERRED],
      projectRoot,
    });

    assert.equal(report.results.length, 1);
    assert.equal(report.results[0]!.status, "pass");
    assert.equal(report.allPassed, true);
  });
});
