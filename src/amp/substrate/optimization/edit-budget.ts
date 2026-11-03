/**
 * Edit budget enforcement — textual learning rate (AMP §2.2).
 */

import type { CanonicalProcedure } from "../../procedural/schema.js";
import type { EditBudget, ProposedEdit, ProposedEditBudgetUsed } from "./types.js";
import { EditBudgetSchema } from "./types.js";

/** PROVISIONAL defaults per §13.10 — configurable per cycle. */
export const DEFAULT_EDIT_BUDGET: EditBudget = EditBudgetSchema.parse({
  max_lines_changed: 15,
  max_chars_changed: 600,
  preserve_sections: ["## Triggers", "## Falsifiable claim"],
  max_frontmatter_keys_changed: 3,
});

export interface EditBudgetViolation {
  ok: false;
  reason: string;
}

export type EditBudgetCheckResult = { ok: true; budgetUsed: ProposedEditBudgetUsed } | EditBudgetViolation;

function lineDiffCount(before: string, after: string): number {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const max = Math.max(beforeLines.length, afterLines.length);
  let changed = 0;
  for (let index = 0; index < max; index += 1) {
    if ((beforeLines[index] ?? "") !== (afterLines[index] ?? "")) {
      changed += 1;
    }
  }
  return changed;
}

/**
 * Magnitude of churned text, not the net length delta. Position-aligned per line;
 * a same-length rewrite still counts the changed line (no length-delta bypass).
 */
function charDiffCount(before: string, after: string): number {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const max = Math.max(beforeLines.length, afterLines.length);
  let chars = 0;
  for (let index = 0; index < max; index += 1) {
    const beforeLine = beforeLines[index] ?? "";
    const afterLine = afterLines[index] ?? "";
    if (beforeLine !== afterLine) {
      chars += Math.max(beforeLine.length, afterLine.length);
    }
  }
  return chars;
}

/** Count frontmatter keys whose value differs (added, removed, or changed). */
function countChangedKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): number {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  let changed = 0;
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed += 1;
    }
  }
  return changed;
}

function sectionRanges(body: string, heading: string): Array<{ start: number; end: number }> {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line === heading);
  if (start < 0) {
    return [];
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index]?.startsWith("## ")) {
      end = index;
      break;
    }
  }

  return [{ start, end }];
}

function touchesPreservedSection(before: string, after: string, preserveSections: readonly string[]): string | undefined {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const max = Math.max(beforeLines.length, afterLines.length);

  for (const heading of preserveSections) {
    const ranges = sectionRanges(before, heading);
    for (const range of ranges) {
      for (let line = range.start; line < range.end; line += 1) {
        if ((beforeLines[line] ?? "") !== (afterLines[line] ?? "")) {
          return `Edit touches preserved section ${heading}`;
        }
      }
    }
  }

  return undefined;
}

/** Measure and validate a proposed body edit against the edit budget. */
export function checkEditBudget(
  before: CanonicalProcedure,
  afterBody: string,
  budget: EditBudget = DEFAULT_EDIT_BUDGET,
  afterFrontmatter?: Record<string, unknown>
): EditBudgetCheckResult {
  const beforeBody = before.body;
  const linesChanged = lineDiffCount(beforeBody, afterBody);
  const charsChanged = charDiffCount(beforeBody, afterBody);

  if (linesChanged > budget.max_lines_changed) {
    return {
      ok: false,
      reason: `Edit exceeds max_lines_changed (${linesChanged} > ${budget.max_lines_changed})`,
    };
  }

  if (charsChanged > budget.max_chars_changed) {
    return {
      ok: false,
      reason: `Edit exceeds max_chars_changed (${charsChanged} > ${budget.max_chars_changed})`,
    };
  }

  const preservedViolation = touchesPreservedSection(beforeBody, afterBody, budget.preserve_sections);
  if (preservedViolation) {
    return { ok: false, reason: preservedViolation };
  }

  // Optimizer edits body only in v1.5, so frontmatter is unchanged by construction;
  // when a proposed frontmatter is supplied, the key churn is measured for real.
  const frontmatterKeysChanged = afterFrontmatter
    ? countChangedKeys(
        before.frontmatter as unknown as Record<string, unknown>,
        afterFrontmatter
      )
    : 0;
  if (frontmatterKeysChanged > budget.max_frontmatter_keys_changed) {
    return {
      ok: false,
      reason: `Edit exceeds max_frontmatter_keys_changed (${frontmatterKeysChanged} > ${budget.max_frontmatter_keys_changed})`,
    };
  }

  return {
    ok: true,
    budgetUsed: {
      linesChanged,
      charsChanged,
      frontmatterKeysChanged,
    },
  };
}

/** Validate an assembled ProposedEdit against budget constraints. */
export function validateProposedEditBudget(
  before: CanonicalProcedure,
  proposed: ProposedEdit,
  budget: EditBudget = DEFAULT_EDIT_BUDGET
): EditBudgetCheckResult {
  if (proposed.bodyAfter === before.body) {
    return { ok: false, reason: "Proposed edit makes no body change" };
  }

  const measured = checkEditBudget(before, proposed.bodyAfter, budget);
  if (!measured.ok) {
    return measured;
  }

  if (proposed.budgetUsed.linesChanged !== measured.budgetUsed.linesChanged) {
    return { ok: false, reason: "Proposed edit budgetUsed.linesChanged mismatch" };
  }

  return measured;
}

/** Build a minimal unified diff string for audit trails. */
export function buildUnifiedBodyDiff(beforeBody: string, afterBody: string): string {
  return [`--- body`, `+++ body`, "@@", beforeBody, "---", afterBody].join("\n");
}
