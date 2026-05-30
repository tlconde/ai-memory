import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createCanonicalProcedure } from "../../procedural/schema.js";
import { DEFAULT_EDIT_BUDGET, checkEditBudget } from "./edit-budget.js";

describe("checkEditBudget", () => {
  it("rejects edits exceeding max_lines_changed", () => {
    const procedure = createCanonicalProcedure({
      name: "budget-skill",
      body: "line1\nline2\n",
    });
    const after = Array.from({ length: 20 }, (_, index) => `line${index}`).join("\n");
    const result = checkEditBudget(procedure, after, DEFAULT_EDIT_BUDGET);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /max_lines_changed/);
  });

  it("rejects edits touching preserved sections", () => {
    const procedure = createCanonicalProcedure({
      name: "preserve-skill",
      body: "## Triggers\n\n- /test\n\n## Body\n",
    });
    const after = "## Triggers\n\n- /changed\n\n## Body\n";
    const result = checkEditBudget(procedure, after, DEFAULT_EDIT_BUDGET);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /preserved section/);
  });

  it("allows edits below preserved sections without false positives", () => {
    const procedure = createCanonicalProcedure({
      name: "preserve-skill",
      body: `# Safe test runner

## Falsifiable claim

Runs unit tests safely.

## Steps

Use the --no-verify flag when running tests.
`,
    });
    const after = procedure.body.replace(
      "Use the --no-verify flag",
      "Never use --no-verify; always run hooks"
    );
    const result = checkEditBudget(procedure, after, DEFAULT_EDIT_BUDGET);
    assert.equal(result.ok, true);
  });

  it("counts same-length rewrites against max_chars_changed (no length-delta bypass)", () => {
    const procedure = createCanonicalProcedure({
      name: "rewrite-skill",
      body: `${"a".repeat(700)}\n`,
    });
    const after = `${"b".repeat(700)}\n`;
    const result = checkEditBudget(procedure, after, DEFAULT_EDIT_BUDGET);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /max_chars_changed/);
  });

  it("enforces max_frontmatter_keys_changed when a proposed frontmatter is supplied", () => {
    const procedure = createCanonicalProcedure({ name: "fm-skill", body: "body\n" });
    const before = procedure.frontmatter as unknown as Record<string, unknown>;
    const proposedFrontmatter = { ...before, k1: 1, k2: 2, k3: 3, k4: 4 };
    const result = checkEditBudget(procedure, procedure.body, DEFAULT_EDIT_BUDGET, proposedFrontmatter);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /max_frontmatter_keys_changed/);
  });
});
