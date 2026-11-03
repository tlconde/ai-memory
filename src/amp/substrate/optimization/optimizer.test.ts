import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createCanonicalProcedure } from "../../procedural/schema.js";
import { createCorpusEntry } from "./corpus.js";
import { createDeterministicValidationGate } from "./validation-gate.js";
import { buildUnifiedBodyDiff, DEFAULT_EDIT_BUDGET } from "./edit-budget.js";
import { createRuleBasedOptimizer, proposeBodyEdit } from "./optimizer.js";

describe("createDeterministicValidationGate", () => {
  it("rejects proposals that do not strictly improve holdout score", () => {
    const gate = createDeterministicValidationGate();
    const before = createCanonicalProcedure({
      name: "gate-skill",
      body: "# Skill\n\nGood guidance.\n",
    });
    const holdout = [
      createCorpusEntry({
        id: "holdout-1",
        skillName: "gate-skill",
        summary: "Holdout qrel",
        mustNotContain: ["noisy debug logging"],
        holdout: true,
      }),
    ];
    const proposed = createRuleBasedOptimizer().propose(
      before,
      [
        createCorpusEntry({
          id: "train-1",
          skillName: "gate-skill",
          summary: "Train",
          expectedBehavior: "noisy debug logging",
        }),
      ],
      [],
      DEFAULT_EDIT_BUDGET
    );
    assert.ok(proposed);
    const afterFromProposal = { ...before, body: proposed!.bodyAfter };

    const result = gate.validate(before, afterFromProposal, holdout, DEFAULT_EDIT_BUDGET, proposed!);
    assert.equal(result.decision, "reject");
    assert.ok(result.reject_reason);
  });
});

describe("createRuleBasedOptimizer", () => {
  it("propose stays within budget and writes nothing to registry", () => {
    const optimizer = createRuleBasedOptimizer();
    const procedure = createCanonicalProcedure({
      name: "optimizer-skill",
      body: "# Skill\n\nRun tests with --no-verify.\n",
    });
    const corpus = [
      createCorpusEntry({
        id: "corr-1",
        skillName: "optimizer-skill",
        summary: "Fix hook bypass",
        avoidPhrase: "--no-verify",
        expectedBehavior: "Never use --no-verify",
      }),
    ];

    const proposed = optimizer.propose(procedure, corpus, [], DEFAULT_EDIT_BUDGET);
    assert.ok(proposed);
    assert.notEqual(proposed!.bodyAfter, procedure.body);
    assert.ok(proposed!.budgetUsed.linesChanged <= DEFAULT_EDIT_BUDGET.max_lines_changed);
    assert.equal(procedure.body, "# Skill\n\nRun tests with --no-verify.\n");
    assert.ok(proposed!.unifiedDiff.includes(buildUnifiedBodyDiff(procedure.body, proposed!.bodyAfter).slice(0, 10)));
  });
});
