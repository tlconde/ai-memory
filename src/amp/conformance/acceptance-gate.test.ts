import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { INVARIANT_IDS } from "./invariant-registry.js";
import {
  AMP_V1_PROVISIONAL_DISCLAIMER,
  conformanceMeetsAcceptancePolicy,
  evaluateAcceptanceGate,
  formatAcceptanceGateReport,
  runAcceptanceGate,
  type AcceptanceGateReport,
} from "./acceptance-gate.js";
import { DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP } from "./acceptance-durable-local-loop.js";
import type { ConformanceReport } from "./conformance-runner.js";

function baseReport(overrides: Partial<AcceptanceGateReport> = {}): AcceptanceGateReport {
  const conformance: ConformanceReport = {
    allPassed: true,
    results: [
      { invariantId: INVARIANT_IDS.INV_1_SCOPE_NEVER_INFERRED, description: "a", status: "pass", testFiles: [] },
      { invariantId: INVARIANT_IDS.INV_3_CLOUD_BOUNDED, description: "b", status: "deferred", testFiles: [] },
    ],
  };
  return {
    projectRoot: "/repo",
    steps: [
      { step: "typecheck", passed: true },
      { step: "build", passed: true },
      { step: "test", passed: true },
      { step: "conformance", passed: true },
      { step: "cli: amp --help", passed: true },
      { step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP, passed: true },
    ],
    conformance,
    conformanceOutput: "PASS INV-1\nDEFERRED INV-3\nOverall: PASS",
    allPassed: true,
    ...overrides,
  };
}

describe("acceptance gate", () => {
  it("documents PROVISIONAL/UNKNOWN live-service exclusions", () => {
    assert.match(AMP_V1_PROVISIONAL_DISCLAIMER, /live gbrain serve/i);
    assert.match(AMP_V1_PROVISIONAL_DISCLAIMER, /live harness session/i);
    assert.match(AMP_V1_PROVISIONAL_DISCLAIMER, /PROVISIONAL\/UNKNOWN/i);
  });

  it("passes when all steps pass and only INV-3 is deferred", () => {
    const report = baseReport();
    assert.equal(evaluateAcceptanceGate(report), true);
  });

  it("fails when a build step fails", () => {
    const report = baseReport({
      steps: [
        { step: "typecheck", passed: true },
        { step: "build", passed: false, detail: "tsc error" },
      ],
    });
    assert.equal(evaluateAcceptanceGate(report), false);
  });

  it("fails when conformance has a failing invariant", () => {
    const report = baseReport({
      conformance: {
        allPassed: false,
        results: [
          {
            invariantId: INVARIANT_IDS.INV_4_FROM_AMP_ISOLATED,
            description: "from-amp isolation",
            status: "fail",
            testFiles: ["src/amp/path-safety/guard.test.ts"],
            message: "exited 1",
          },
        ],
      },
      conformanceOutput: "FAIL INV-4\nOverall: FAIL",
    });
    assert.equal(evaluateAcceptanceGate(report), false);
  });

  it("fails when a non-INV-3 invariant is deferred", () => {
    const report = baseReport({
      conformance: {
        allPassed: true,
        results: [
          {
            invariantId: INVARIANT_IDS.INV_2_INJECTABILITY_HONEST,
            description: "injectability",
            status: "deferred",
            testFiles: [],
          },
        ],
      },
    });
    assert.equal(evaluateAcceptanceGate(report), false);
    assert.equal(conformanceMeetsAcceptancePolicy(report.conformance), false);
  });

  it("marks conformance step failed when a non-INV-3 invariant is deferred", async () => {
    const conformance: ConformanceReport = {
      allPassed: true,
      results: [
        {
          invariantId: INVARIANT_IDS.INV_2_INJECTABILITY_HONEST,
          description: "injectability",
          status: "deferred",
          testFiles: [],
        },
      ],
    };

    const report = await runAcceptanceGate({
      skipBuildSteps: true,
      runConformanceFn: async () => conformance,
    });

    assert.equal(report.allPassed, false);
    assert.equal(report.steps.find((step) => step.step === "conformance")?.passed, false);
    assert.match(
      report.steps.find((step) => step.step === "conformance")?.detail ?? "",
      /allows only the documented INV-3 deferral/
    );
  });

  it("does not run conformance when a required build step fails early", async () => {
    let conformanceCalls = 0;

    const report = await runAcceptanceGate({
      runNpmScriptFn: (_cwd, script) => ({
        step: script,
        passed: script !== "typecheck",
        detail: script === "typecheck" ? "synthetic typecheck failure" : undefined,
      }),
      runConformanceFn: async () => {
        conformanceCalls += 1;
        return baseReport().conformance;
      },
    });

    assert.equal(conformanceCalls, 0);
    assert.equal(report.allPassed, false);
    assert.deepEqual(
      report.steps.map((step) => step.step),
      ["typecheck"]
    );
    assert.equal(report.conformanceOutput, "(skipped — prior step failed)");
  });

  it("formats PASS/FAIL summary and conformance output", () => {
    const formatted = formatAcceptanceGateReport(baseReport());
    assert.match(formatted, /AMP v1 ACCEPTANCE: PASS/);
    assert.match(formatted, /DEFERRED INV-3/);
    assert.match(formatted, /cli: amp --help/);
    assert.match(formatted, new RegExp(DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("includes durable local loop step when conformance passes", async () => {
    const report = await runAcceptanceGate({
      skipBuildSteps: true,
      skipDurableLocalLoopStep: true,
      runConformanceFn: async () => baseReport().conformance,
    });

    assert.equal(
      report.steps.some((step) => step.step === DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP),
      false,
    );

    const withLoop = await runAcceptanceGate({
      skipBuildSteps: true,
      runConformanceFn: async () => baseReport().conformance,
      runDurableLocalLoopStepFn: async () => ({
        step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
        passed: true,
      }),
    });

    assert.equal(
      withLoop.steps.find((step) => step.step === DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP)?.passed,
      true,
    );
  });

  it("formats FAIL summary when steps fail", () => {
    const formatted = formatAcceptanceGateReport(
      baseReport({
        allPassed: false,
        steps: [{ step: "test", passed: false, detail: "assertion failed" }],
      })
    );
    assert.match(formatted, /AMP v1 ACCEPTANCE: FAIL/);
    assert.match(formatted, /FAIL test/);
  });
});
