/**
 * ValidationGate — accept only on strict holdout improvement (AMP §2.1).
 */

import type { CanonicalProcedure } from "../../procedural/schema.js";
import { scoreProcedureOnCorpus } from "./eval.js";
import { validateProposedEditBudget } from "./edit-budget.js";
import type {
  CorrectionCorpusEntry,
  EditBudget,
  ProposedEdit,
  ValidationGate,
  ValidationResult,
} from "./types.js";

/** Deterministic validation gate for optimization cycles. */
export function createDeterministicValidationGate(): ValidationGate {
  return {
    validate(before, after, holdoutCorpus, budget, proposed) {
      const reasons: string[] = [];

      const budgetCheck = validateProposedEditBudget(before, proposed, budget);
      if (!budgetCheck.ok) {
        return {
          decision: "reject",
          scoreBefore: scoreProcedureOnCorpus(before, holdoutCorpus),
          scoreAfter: scoreProcedureOnCorpus(after, holdoutCorpus),
          reasons: [budgetCheck.reason],
          reject_reason: budgetCheck.reason,
        };
      }

      const scoreBefore = scoreProcedureOnCorpus(before, holdoutCorpus);
      const scoreAfter = scoreProcedureOnCorpus(after, holdoutCorpus);

      if (scoreAfter <= scoreBefore) {
        const reject_reason = `Holdout score did not strictly improve (${scoreAfter.toFixed(4)} <= ${scoreBefore.toFixed(4)})`;
        return {
          decision: "reject",
          scoreBefore,
          scoreAfter,
          reasons: [reject_reason],
          reject_reason,
        };
      }

      reasons.push(`Holdout score improved ${scoreBefore.toFixed(4)} -> ${scoreAfter.toFixed(4)}`);
      return {
        decision: "accept",
        scoreBefore,
        scoreAfter,
        reasons,
      };
    },
  };
}

export function splitCorpusByHoldout(
  corpus: readonly CorrectionCorpusEntry[]
): { train: CorrectionCorpusEntry[]; holdout: CorrectionCorpusEntry[] } {
  const train: CorrectionCorpusEntry[] = [];
  const holdout: CorrectionCorpusEntry[] = [];
  for (const entry of corpus) {
    if (entry.holdout) {
      holdout.push(entry);
    } else {
      train.push(entry);
    }
  }
  return { train, holdout };
}

export type { ValidationResult };
