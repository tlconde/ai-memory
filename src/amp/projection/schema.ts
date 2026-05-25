/**
 * AMP filesystem projection document schema.
 *
 * Falsifiable claim: a projection markdown artifact round-trips through Zod
 * validation with scope, source revision, generated_at, and token-budget metadata
 * preserved. Schema only — no DB materialization.
 */

import { z } from "zod";

import {
  AMP_PROJECTION_ARTIFACT_VERSION,
  DEFAULT_COMBINED_TOKEN_BUDGET,
  DEFAULT_FILE_TOKEN_TARGETS,
  PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER,
  PROJECTION_FILE_KINDS,
  type ProjectionFileKind,
} from "./constants.js";

export type { ProjectionFileKind };

export const ProjectionFileKindSchema = z.enum(PROJECTION_FILE_KINDS);

export const ProjectionScopeSchema = z.enum(["global", "project"]);
export type ProjectionScope = z.infer<typeof ProjectionScopeSchema>;

export const ProjectionSourceStoreSchema = z.enum(["knowledge", "runtime"]);
export type ProjectionSourceStore = z.infer<typeof ProjectionSourceStoreSchema>;

export const ProjectionCadenceSchema = z.enum(["on_consolidation", "session_start_and_runtime_change"]);
export type ProjectionCadence = z.infer<typeof ProjectionCadenceSchema>;

export const ProjectionBudgetStatusSchema = z.enum(["ok", "warning", "exceeded"]);
export type ProjectionBudgetStatus = z.infer<typeof ProjectionBudgetStatusSchema>;

export const ProjectionBudgetMetadataSchema = z
  .object({
    token_target: z.number().int().positive(),
    token_count: z.number().int().nonnegative(),
    combined_cap: z.number().int().positive(),
    combined_count: z.number().int().nonnegative(),
    status: ProjectionBudgetStatusSchema,
    truncated: z.boolean(),
    truncation_marker: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((budget, ctx) => {
    const hardCap = budget.combined_cap * PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER;
    if (budget.combined_count > hardCap) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `combined_count must not exceed ${PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER}x combined_cap (${hardCap})`,
        path: ["combined_count"],
      });
    }
    if (budget.status === "exceeded" && budget.combined_count <= budget.combined_cap) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "status exceeded requires combined_count above combined_cap",
        path: ["status"],
      });
    }
    if (budget.status === "warning" && budget.combined_count <= budget.combined_cap) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "status warning requires combined_count above combined_cap",
        path: ["status"],
      });
    }
    if (budget.truncated && !budget.truncation_marker) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "truncation_marker is required when truncated is true",
        path: ["truncation_marker"],
      });
    }
  });

export type ProjectionBudgetMetadata = z.infer<typeof ProjectionBudgetMetadataSchema>;

export const ProjectionMetadataHeaderSchema = z
  .object({
    amp_projection_version: z.string().min(1).default(AMP_PROJECTION_ARTIFACT_VERSION),
    kind: ProjectionFileKindSchema,
    scope: ProjectionScopeSchema,
    project_ref: z.string().min(1).optional(),
    generated_at: z.string().datetime(),
    source_revision: z.string().min(1),
    source_store: ProjectionSourceStoreSchema,
    cadence: ProjectionCadenceSchema,
    budget: ProjectionBudgetMetadataSchema,
  })
  .strict()
  .superRefine((header, ctx) => {
    const expectedScope = header.kind.startsWith("global_") ? "global" : "project";
    if (header.scope !== expectedScope) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `scope ${header.scope} does not match kind ${header.kind}`,
        path: ["scope"],
      });
    }

    if (header.scope === "project" && !header.project_ref) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "project scope requires project_ref",
        path: ["project_ref"],
      });
    }

    if (header.scope === "global" && header.project_ref) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "project_ref is only valid for project scope",
        path: ["project_ref"],
      });
    }

    const expectedStore: ProjectionSourceStore = header.kind.endsWith("_runtime")
      ? "runtime"
      : "knowledge";
    if (header.source_store !== expectedStore) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `source_store ${header.source_store} does not match kind ${header.kind}`,
        path: ["source_store"],
      });
    }

    const expectedTarget = DEFAULT_FILE_TOKEN_TARGETS[header.kind];
    if (header.budget.token_target !== expectedTarget) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `token_target must be ${expectedTarget} for kind ${header.kind}`,
        path: ["budget", "token_target"],
      });
    }
  });

export type ProjectionMetadataHeader = z.infer<typeof ProjectionMetadataHeaderSchema>;

export const ProjectionDocumentSchema = z
  .object({
    metadata: ProjectionMetadataHeaderSchema,
    body: z.string(),
  })
  .strict();

export type ProjectionDocument = z.infer<typeof ProjectionDocumentSchema>;

export interface ProjectionFileSpec {
  kind: ProjectionFileKind;
  scope: ProjectionScope;
  source_store: ProjectionSourceStore;
  cadence: ProjectionCadence;
  default_token_target: number;
  description: string;
}

export const PROJECTION_FILE_SPECS: Readonly<Record<ProjectionFileKind, ProjectionFileSpec>> = {
  global_projection: {
    kind: "global_projection",
    scope: "global",
    source_store: "knowledge",
    cadence: "on_consolidation",
    default_token_target: DEFAULT_FILE_TOKEN_TARGETS.global_projection,
    description: "Cross-project durable knowledge: identity, style, confirmed facts.",
  },
  global_runtime: {
    kind: "global_runtime",
    scope: "global",
    source_store: "runtime",
    cadence: "session_start_and_runtime_change",
    default_token_target: DEFAULT_FILE_TOKEN_TARGETS.global_runtime,
    description: "Cross-project working memory: active intent and recent corrections.",
  },
  project_projection: {
    kind: "project_projection",
    scope: "project",
    source_store: "knowledge",
    cadence: "on_consolidation",
    default_token_target: DEFAULT_FILE_TOKEN_TARGETS.project_projection,
    description: "Project-scoped durable knowledge: decisions, stack, conventions.",
  },
  project_runtime: {
    kind: "project_runtime",
    scope: "project",
    source_store: "runtime",
    cadence: "session_start_and_runtime_change",
    default_token_target: DEFAULT_FILE_TOKEN_TARGETS.project_runtime,
    description: "Project-scoped working memory: in-flight work and corrections.",
  },
};

export type ProjectionDocumentParseResult =
  | { success: true; document: ProjectionDocument }
  | { success: false; error: string; issues?: z.ZodIssue[] };

export function parseProjectionDocument(input: unknown): ProjectionDocument {
  return ProjectionDocumentSchema.parse(input);
}

export function safeParseProjectionDocument(input: unknown): ProjectionDocumentParseResult {
  const parsed = ProjectionDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Projection document failed schema validation",
      issues: parsed.error.issues,
    };
  }
  return { success: true, document: parsed.data };
}

export interface CreateProjectionDocumentOptions {
  kind: ProjectionFileKind;
  body?: string;
  generated_at?: string;
  source_revision?: string;
  project_ref?: string;
  token_count?: number;
  combined_count?: number;
  status?: ProjectionBudgetStatus;
  truncated?: boolean;
  truncation_marker?: string;
}

/** Build a minimal valid projection document for tests and fixtures. */
export function createProjectionDocument(
  options: CreateProjectionDocumentOptions
): ProjectionDocument {
  const spec = PROJECTION_FILE_SPECS[options.kind];
  const tokenCount = options.token_count ?? 0;
  const combinedCount = options.combined_count ?? tokenCount;
  const combinedCap = DEFAULT_COMBINED_TOKEN_BUDGET;
  const status =
    options.status ??
    (combinedCount > combinedCap * PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER
      ? "exceeded"
      : combinedCount > combinedCap
        ? "warning"
        : "ok");
  const truncated = options.truncated ?? status !== "ok";

  const metadata: ProjectionMetadataHeader = {
    amp_projection_version: AMP_PROJECTION_ARTIFACT_VERSION,
    kind: options.kind,
    scope: spec.scope,
    generated_at: options.generated_at ?? "2026-05-25T00:00:00.000Z",
    source_revision: options.source_revision ?? "rev-test-0001",
    source_store: spec.source_store,
    cadence: spec.cadence,
    budget: {
      token_target: spec.default_token_target,
      token_count: tokenCount,
      combined_cap: combinedCap,
      combined_count: combinedCount,
      status,
      truncated,
      ...(truncated
        ? { truncation_marker: options.truncation_marker ?? "<!-- amp:truncated -->" }
        : {}),
    },
    ...(spec.scope === "project"
      ? { project_ref: options.project_ref ?? "example-project" }
      : {}),
  };

  return {
    metadata,
    body: options.body ?? `# ${spec.kind}\n\nProjection body placeholder.\n`,
  };
}
