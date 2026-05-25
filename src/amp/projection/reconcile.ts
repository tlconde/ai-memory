/**
 * Reconcile projection budget metadata across a document set.
 *
 * Falsifiable claim: given documents with per-file token_count values, returns
 * new documents whose combined_count, combined_cap, and budget.status match the
 * evaluator truth without mutating the input set.
 */

import {
  DEFAULT_COMBINED_TOKEN_BUDGET,
  PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER,
  PROJECTION_TRUNCATION_MARKER,
} from "./constants.js";
import {
  parseProjectionDocument,
  type ProjectionBudgetStatus,
  type ProjectionDocument,
} from "./schema.js";

export interface ReconcileProjectionMetadataOptions {
  combinedCap?: number;
}

export class ProjectionMetadataReconcileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectionMetadataReconcileError";
  }
}

function budgetStatus(count: number, cap: number): ProjectionBudgetStatus {
  if (count <= cap) {
    return "ok";
  }
  if (count <= cap * PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER) {
    return "warning";
  }
  return "exceeded";
}

/** Recompute combined budget metadata from per-file token_count values. */
export function reconcileProjectionMetadata(
  documents: readonly ProjectionDocument[],
  options: ReconcileProjectionMetadataOptions = {}
): ProjectionDocument[] {
  const combinedCap = options.combinedCap ?? DEFAULT_COMBINED_TOKEN_BUDGET;
  const combinedCount = documents.reduce(
    (sum, document) => sum + document.metadata.budget.token_count,
    0
  );
  const hardCap = combinedCap * PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER;

  if (combinedCount > hardCap) {
    throw new ProjectionMetadataReconcileError(
      `combined_count ${combinedCount} exceeds hard cap ${hardCap} (${PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER}x combined_cap ${combinedCap})`
    );
  }

  const status = budgetStatus(combinedCount, combinedCap);
  const truncated = status !== "ok";

  return documents.map((document) => {
    const budget = {
      ...document.metadata.budget,
      combined_cap: combinedCap,
      combined_count: combinedCount,
      status,
      truncated,
      ...(truncated
        ? {
            truncation_marker:
              document.metadata.budget.truncation_marker ?? PROJECTION_TRUNCATION_MARKER,
          }
        : {}),
    };

    if (!truncated && "truncation_marker" in budget) {
      delete budget.truncation_marker;
    }

    return parseProjectionDocument({
      metadata: {
        ...document.metadata,
        budget,
      },
      body: document.body,
    });
  });
}
