import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_COMBINED_TOKEN_BUDGET,
  DEFAULT_FILE_TOKEN_TARGETS,
  PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER,
  PROJECTION_FILE_KINDS,
  createProjectionDocument,
} from "./index.js";
import {
  ProjectionBudgetHardFailError,
  evaluateProjectionBudget,
  evaluateProjectionBudgetOrThrow,
} from "./budget.js";

function doc(kind: (typeof PROJECTION_FILE_KINDS)[number], tokenCount: number) {
  return createProjectionDocument({ kind, token_count: tokenCount, combined_count: 0, status: "ok" });
}

describe("evaluateProjectionBudget", () => {
  it("returns ok when combined token count is within cap", () => {
    const result = evaluateProjectionBudget([
      doc("global_projection", 400),
      doc("global_runtime", 200),
      doc("project_projection", 600),
      doc("project_runtime", 400),
    ]);

    assert.equal(result.success, true);
    if (!result.success) return;

    assert.equal(result.combined.combined_count, 1600);
    assert.equal(result.combined.combined_cap, DEFAULT_COMBINED_TOKEN_BUDGET);
    assert.equal(result.combined.status, "ok");
    assert.equal(result.files.length, 4);
    assert.ok(result.files.every((file) => file.present));
  });

  it("returns warning when combined token count exceeds cap but not hard cap", () => {
    const overCap = DEFAULT_COMBINED_TOKEN_BUDGET + 100;
    const result = evaluateProjectionBudget({
      global_projection: doc("global_projection", overCap),
    });

    assert.equal(result.success, true);
    if (!result.success) return;

    assert.equal(result.combined.combined_count, overCap);
    assert.equal(result.combined.status, "warning");
    assert.equal(result.files.filter((file) => file.present).length, 1);
    assert.ok(result.files.filter((file) => !file.present).every((file) => file.token_count === 0));
  });

  it("hard fails when combined token count exceeds 2x cap", () => {
    const hardCap = DEFAULT_COMBINED_TOKEN_BUDGET * PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER;
    const overHardCap = hardCap + 1;
    const result = evaluateProjectionBudget({
      project_projection: doc("project_projection", overHardCap),
    });

    assert.equal(result.success, false);
    if (result.success) return;

    assert.match(result.error, /hard cap/);
    assert.equal(result.combined.combined_count, overHardCap);
    assert.equal(result.combined.status, "exceeded");
    assert.equal(result.combined.hard_cap, hardCap);
  });

  it("treats missing kinds as zero tokens", () => {
    const result = evaluateProjectionBudget({
      global_runtime: doc("global_runtime", 150),
    });

    assert.equal(result.success, true);
    if (!result.success) return;

    assert.equal(result.combined.combined_count, 150);
    assert.equal(result.combined.status, "ok");
    assert.equal(result.files.find((file) => file.kind === "global_runtime")?.present, true);
    assert.equal(result.files.find((file) => file.kind === "global_projection")?.present, false);
    assert.equal(result.files.find((file) => file.kind === "global_projection")?.token_count, 0);
  });

  it("accepts a custom combined cap", () => {
    const customCap = 500;
    const result = evaluateProjectionBudget([doc("global_projection", 600)], { combinedCap: customCap });

    assert.equal(result.success, true);
    if (!result.success) return;

    assert.equal(result.combined.combined_cap, customCap);
    assert.equal(result.combined.combined_count, 600);
    assert.equal(result.combined.status, "warning");
    assert.equal(result.combined.hard_cap, customCap * PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER);
  });

  it("marks per-file exceeded when token_count exceeds 2x token_target", () => {
    const target = DEFAULT_FILE_TOKEN_TARGETS.global_projection;
    const result = evaluateProjectionBudget([
      doc("global_projection", target * PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER + 1),
    ]);

    assert.equal(result.success, true);
    if (!result.success) return;

    const file = result.files.find((entry) => entry.kind === "global_projection");
    assert.equal(file?.status, "exceeded");
  });
});

describe("evaluateProjectionBudgetOrThrow", () => {
  it("throws ProjectionBudgetHardFailError on hard fail", () => {
    const hardCap = DEFAULT_COMBINED_TOKEN_BUDGET * PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER;

    assert.throws(
      () =>
        evaluateProjectionBudgetOrThrow({
          global_projection: doc("global_projection", hardCap + 1),
        }),
      (error: unknown) => {
        assert.ok(error instanceof ProjectionBudgetHardFailError);
        assert.equal(error.combined.combined_count, hardCap + 1);
        assert.equal(error.files.length, PROJECTION_FILE_KINDS.length);
        return true;
      }
    );
  });
});
