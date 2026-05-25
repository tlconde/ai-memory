/**
 * Deterministic projection token budget evaluation.
 *
 * Falsifiable claim: given projection documents (full or partial set), sums
 * per-file token_count metadata, compares against combined cap, and returns
 * structured ok/warning/exceeded status with hard fail above 2× cap.
 */

import {
  DEFAULT_COMBINED_TOKEN_BUDGET,
  DEFAULT_FILE_TOKEN_TARGETS,
  PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER,
  PROJECTION_FILE_KINDS,
  type ProjectionFileKind,
} from "./constants.js";
import type { ProjectionBudgetStatus, ProjectionDocument } from "./schema.js";

export type ProjectionDocumentInput =
  | Partial<Record<ProjectionFileKind, ProjectionDocument>>
  | ProjectionDocument[];

export interface EvaluateProjectionBudgetOptions {
  combinedCap?: number;
}

export interface ProjectionFileBudgetEvaluation {
  kind: ProjectionFileKind;
  present: boolean;
  token_count: number;
  token_target: number;
  status: ProjectionBudgetStatus;
}

export interface ProjectionCombinedBudgetEvaluation {
  combined_cap: number;
  combined_count: number;
  hard_cap: number;
  status: ProjectionBudgetStatus;
}

export type EvaluateProjectionBudgetResult =
  | {
      success: true;
      files: ProjectionFileBudgetEvaluation[];
      combined: ProjectionCombinedBudgetEvaluation;
    }
  | {
      success: false;
      error: string;
      files: ProjectionFileBudgetEvaluation[];
      combined: ProjectionCombinedBudgetEvaluation;
    };

export class ProjectionBudgetHardFailError extends Error {
  readonly combined: ProjectionCombinedBudgetEvaluation;
  readonly files: ProjectionFileBudgetEvaluation[];

  constructor(
    message: string,
    combined: ProjectionCombinedBudgetEvaluation,
    files: ProjectionFileBudgetEvaluation[]
  ) {
    super(message);
    this.name = "ProjectionBudgetHardFailError";
    this.combined = combined;
    this.files = files;
  }
}

function normalizeDocuments(
  input: ProjectionDocumentInput
): Partial<Record<ProjectionFileKind, ProjectionDocument>> {
  if (Array.isArray(input)) {
    const record: Partial<Record<ProjectionFileKind, ProjectionDocument>> = {};
    for (const document of input) {
      const kind = document.metadata.kind;
      record[kind] = document;
    }
    return record;
  }

  return input;
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

function evaluateFiles(
  documents: Partial<Record<ProjectionFileKind, ProjectionDocument>>
): ProjectionFileBudgetEvaluation[] {
  return PROJECTION_FILE_KINDS.map((kind) => {
    const document = documents[kind];
    const tokenTarget = DEFAULT_FILE_TOKEN_TARGETS[kind];
    const tokenCount = document?.metadata.budget.token_count ?? 0;

    return {
      kind,
      present: document !== undefined,
      token_count: tokenCount,
      token_target: tokenTarget,
      status: budgetStatus(tokenCount, tokenTarget),
    };
  });
}

function buildCombinedEvaluation(
  combinedCount: number,
  combinedCap: number
): ProjectionCombinedBudgetEvaluation {
  const hardCap = combinedCap * PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER;
  return {
    combined_cap: combinedCap,
    combined_count: combinedCount,
    hard_cap: hardCap,
    status: budgetStatus(combinedCount, combinedCap),
  };
}

/** Evaluate projection token budgets from document metadata only (no tokenization). */
export function evaluateProjectionBudget(
  input: ProjectionDocumentInput,
  options: EvaluateProjectionBudgetOptions = {}
): EvaluateProjectionBudgetResult {
  const combinedCap = options.combinedCap ?? DEFAULT_COMBINED_TOKEN_BUDGET;
  const documents = normalizeDocuments(input);
  const files = evaluateFiles(documents);
  const combinedCount = files.reduce((sum, file) => sum + file.token_count, 0);
  const combined = buildCombinedEvaluation(combinedCount, combinedCap);

  if (combinedCount > combined.hard_cap) {
    return {
      success: false,
      error: `combined_count ${combinedCount} exceeds hard cap ${combined.hard_cap} (${PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER}x combined_cap ${combinedCap})`,
      files,
      combined,
    };
  }

  return { success: true, files, combined };
}

/** Like evaluateProjectionBudget but throws ProjectionBudgetHardFailError on hard fail. */
export function evaluateProjectionBudgetOrThrow(
  input: ProjectionDocumentInput,
  options: EvaluateProjectionBudgetOptions = {}
): {
  files: ProjectionFileBudgetEvaluation[];
  combined: ProjectionCombinedBudgetEvaluation;
} {
  const result = evaluateProjectionBudget(input, options);
  if (!result.success) {
    throw new ProjectionBudgetHardFailError(result.error, result.combined, result.files);
  }
  return { files: result.files, combined: result.combined };
}
