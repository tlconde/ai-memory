/**
 * Canonical projection planning and materialization pipeline.
 *
 * Falsifiable claim: load → reconcile → budget gate → dry-run plan or atomic
 * apply writes; blocked/error paths omit fake success budgets.
 */

import { resolve } from "node:path";

import {
  evaluateProjectionBudget,
  type EvaluateProjectionBudgetResult,
} from "./budget.js";
import {
  BUDGET_HARD_FAIL_BLOCKS_APPLY,
  DB_BACKED_MATERIALIZATION_NOT_WIRED,
} from "./messages.js";
import type { PathContext } from "./paths.js";
import {
  ProjectionMetadataReconcileError,
  reconcileProjectionMetadata,
} from "./reconcile.js";
import type { ProjectionDocument } from "./schema.js";
import type { ProjectionSource, ProjectionSourceLoadOptions } from "./source.js";
import { writeProjectionFilesAtomic } from "./atomic-write.js";
import { writeProjectionFiles, type ProjectionWriteResult } from "./write.js";

export type ProjectionMaterializationMode = "dry-run" | "apply";

export interface ProjectionMaterializationOptions extends PathContext {
  projectRoot?: string;
  mode: ProjectionMaterializationMode;
  combinedCap?: number;
  projectRef?: string;
}

export interface ProjectionMaterializationPlan {
  projectRoot: string;
  projectRef?: string;
  dryRun: boolean;
  documents: ProjectionDocument[];
  budget?: EvaluateProjectionBudgetResult;
  writes: ProjectionWriteResult[];
  ok: boolean;
  error?: string;
  blocked?: boolean;
}

type PipelineSuccess = {
  ok: true;
  documents: ProjectionDocument[];
  budget: EvaluateProjectionBudgetResult;
  projectRef?: string;
};

type PipelineFailure = {
  ok: false;
  error: string;
  documents: ProjectionDocument[];
  budget?: EvaluateProjectionBudgetResult;
  projectRef?: string;
};

async function loadDocuments(
  source: ProjectionSource,
  loadOptions: ProjectionSourceLoadOptions
): Promise<ProjectionDocument[]> {
  return Promise.resolve(source.loadProjectionDocuments(loadOptions));
}

function inferProjectRef(
  documents: readonly ProjectionDocument[],
  explicit?: string
): string | undefined {
  if (explicit !== undefined) {
    return explicit;
  }
  return documents.find((document) => document.metadata.scope === "project")?.metadata
    .project_ref;
}

async function runLoadReconcileBudget(
  source: ProjectionSource,
  options: ProjectionMaterializationOptions
): Promise<PipelineSuccess | PipelineFailure> {
  const loadOptions: ProjectionSourceLoadOptions = {};
  if (options.projectRef !== undefined) {
    loadOptions.projectRef = options.projectRef;
  }

  const raw = await loadDocuments(source, loadOptions);
  const projectRef = inferProjectRef(raw, options.projectRef);

  try {
    const documents = reconcileProjectionMetadata(raw, {
      combinedCap: options.combinedCap,
    });
    const budget = evaluateProjectionBudget(documents, {
      combinedCap: options.combinedCap,
    });

    if (!budget.success) {
      return {
        ok: false,
        error: budget.error,
        documents,
        budget,
        projectRef,
      };
    }

    return { ok: true, documents, budget, projectRef };
  } catch (error) {
    if (error instanceof ProjectionMetadataReconcileError) {
      const budget = evaluateProjectionBudget(raw, {
        combinedCap: options.combinedCap,
      });
      if (!budget.success) {
        return {
          ok: false,
          error: budget.error,
          documents: raw,
          budget,
          projectRef,
        };
      }
      return {
        ok: false,
        error: error.message,
        documents: raw,
        projectRef,
      };
    }
    throw error;
  }
}

async function planWrites(
  documents: readonly ProjectionDocument[],
  options: ProjectionMaterializationOptions,
  projectRoot: string
): Promise<ProjectionWriteResult[]> {
  return writeProjectionFiles(documents, {
    projectRoot,
    dryRun: true,
    env: options.env,
    homedir: options.homedir,
  });
}

function failurePlan(
  projectRoot: string,
  dryRun: boolean,
  failure: PipelineFailure,
  writes: ProjectionWriteResult[] = []
): ProjectionMaterializationPlan {
  return {
    projectRoot,
    projectRef: failure.projectRef,
    dryRun,
    documents: failure.documents,
    ...(failure.budget !== undefined ? { budget: failure.budget } : {}),
    writes,
    ok: false,
    error: failure.error,
  };
}

/** Load, reconcile, evaluate budget, and plan canonical write paths (dry-run only). */
export async function planProjectionMaterialization(
  source: ProjectionSource,
  options: ProjectionMaterializationOptions
): Promise<ProjectionMaterializationPlan> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const pipeline = await runLoadReconcileBudget(source, options);

  if (!pipeline.ok) {
    const writes =
      pipeline.documents.length > 0
        ? await planWrites(pipeline.documents, options, projectRoot)
        : [];
    return failurePlan(projectRoot, true, pipeline, writes);
  }

  const writes = await planWrites(pipeline.documents, options, projectRoot);

  return {
    projectRoot,
    projectRef: pipeline.projectRef,
    dryRun: true,
    documents: pipeline.documents,
    budget: pipeline.budget,
    writes,
    ok: true,
  };
}

/** Plan or apply projection materialization through the canonical pipeline. */
export async function materializeProjections(
  source: ProjectionSource,
  options: ProjectionMaterializationOptions
): Promise<ProjectionMaterializationPlan> {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const isApply = options.mode === "apply";

  if (isApply && !source.supportsApply) {
    return {
      projectRoot,
      projectRef: options.projectRef,
      dryRun: false,
      documents: [],
      writes: [],
      ok: false,
      blocked: true,
      error: DB_BACKED_MATERIALIZATION_NOT_WIRED,
    };
  }

  if (!isApply) {
    return planProjectionMaterialization(source, options);
  }

  const pipeline = await runLoadReconcileBudget(source, options);

  if (!pipeline.ok) {
    const blocked = pipeline.budget !== undefined && !pipeline.budget.success;
    return {
      ...failurePlan(projectRoot, false, pipeline),
      ...(blocked
        ? {
            blocked: true,
            error: BUDGET_HARD_FAIL_BLOCKS_APPLY,
          }
        : {}),
    };
  }

  const writes = await writeProjectionFilesAtomic(pipeline.documents, {
    projectRoot,
    dryRun: false,
    env: options.env,
    homedir: options.homedir,
  });

  return {
    projectRoot,
    projectRef: pipeline.projectRef,
    dryRun: false,
    documents: pipeline.documents,
    budget: pipeline.budget,
    writes,
    ok: true,
  };
}
