/**
 * Rule-based Optimizer.propose — pure, no writes (AMP §2.3 step 4).
 */

import type { CanonicalProcedure } from "../../procedural/schema.js";
import { buildUnifiedBodyDiff, checkEditBudget, DEFAULT_EDIT_BUDGET } from "./edit-budget.js";
import type {
  CorrectionCorpusEntry,
  EditBudget,
  JudgeVerdict,
  Optimizer,
  ProposedEdit,
} from "./types.js";

function firstActionableCorrection(
  corpus: readonly CorrectionCorpusEntry[]
): CorrectionCorpusEntry | undefined {
  return corpus.find(
    (entry) => !entry.holdout && (entry.expectedBehavior || entry.avoidPhrase || entry.mustContain.length > 0)
  );
}

function applyExpectedBehavior(body: string, expectedBehavior: string): string {
  if (body.includes(expectedBehavior)) {
    return body;
  }

  if (body.includes("## Steps")) {
    return body.replace("## Steps", `## Steps\n\n- ${expectedBehavior}`);
  }

  return `${body.trimEnd()}\n\n## Correction guidance\n\n- ${expectedBehavior}\n`;
}

function applyMustContain(body: string, token: string): string {
  if (body.includes(token)) {
    return body;
  }
  return `${body.trimEnd()}\n\n- ${token}\n`;
}

/** Build the next bounded body edit from correction corpus signals. */
export function proposeBodyEdit(
  current: CanonicalProcedure,
  corpus: readonly CorrectionCorpusEntry[],
  budget: EditBudget = DEFAULT_EDIT_BUDGET
): { bodyAfter: string; sourceEntryId: string } | undefined {
  const entry = firstActionableCorrection(corpus);
  if (!entry) {
    return undefined;
  }

  let bodyAfter = current.body;

  if (entry.avoidPhrase && bodyAfter.includes(entry.avoidPhrase)) {
    bodyAfter = bodyAfter.replaceAll(entry.avoidPhrase, entry.expectedBehavior ?? "");
  }

  if (entry.expectedBehavior) {
    bodyAfter = applyExpectedBehavior(bodyAfter, entry.expectedBehavior);
  }

  for (const token of entry.mustContain) {
    bodyAfter = applyMustContain(bodyAfter, token);
  }

  if (bodyAfter === current.body) {
    return undefined;
  }

  const budgetCheck = checkEditBudget(current, bodyAfter, budget);
  if (!budgetCheck.ok) {
    return undefined;
  }

  return { bodyAfter, sourceEntryId: entry.id };
}

/** Pure rule-based optimizer — returns ProposedEdit without registry or filesystem writes. */
export function createRuleBasedOptimizer(): Optimizer {
  return {
    propose(current, corpus, _judgments, budget) {
      const edit = proposeBodyEdit(current, corpus, budget);
      if (!edit) {
        return undefined;
      }

      const budgetCheck = checkEditBudget(current, edit.bodyAfter, budget);
      if (!budgetCheck.ok) {
        return undefined;
      }

      return {
        skillName: current.frontmatter.name,
        unifiedDiff: buildUnifiedBodyDiff(current.body, edit.bodyAfter),
        bodyAfter: edit.bodyAfter,
        budgetUsed: budgetCheck.budgetUsed,
      };
    },
  };
}

/** Assemble a candidate procedure from a proposed body edit. */
export function procedureFromProposedEdit(
  current: CanonicalProcedure,
  proposed: ProposedEdit
): CanonicalProcedure {
  return {
    frontmatter: current.frontmatter,
    body: proposed.bodyAfter,
  };
}

export type { JudgeVerdict };
