/**
 * AMP runtime and durable episodic entity schemas (RUNTIME-02).
 *
 * Falsifiable claim: runtime entities and episodic frames validate with strict
 * unknown-key rejection, fixed event_type enum, and cross-field scope/deletion rules.
 */

import { z } from "zod";

import { CurationModeSchema, ScopeKindSchema } from "../core/frame-schema.js";

export { CurationModeSchema, ScopeKindSchema };

export const RuntimeConfidenceSchema = z.enum(["low", "medium", "high"]);
export type RuntimeConfidence = z.infer<typeof RuntimeConfidenceSchema>;

export const RuntimeSourceSchema = z.enum([
  "user_explicit",
  "agent_inferred",
  "tool_observed",
]);
export type RuntimeSource = z.infer<typeof RuntimeSourceSchema>;

export const EpisodicEventTypeSchema = z.enum([
  "signal_observed",
  "goal_event",
  "decision_event",
  "correction",
  "upstream_applied",
  "hypothesis_event",
  "preference_event",
  "tool_attempt",
  "session_event",
  "projection_event",
  "rejection_event",
]);
export type EpisodicEventType = z.infer<typeof EpisodicEventTypeSchema>;

export const EpisodicLifecycleStateSchema = z.enum([
  "active",
  "dormant",
  "deep_dormant",
  "deleted",
]);
export type EpisodicLifecycleState = z.infer<typeof EpisodicLifecycleStateSchema>;

export const EpisodicSensitivitySchema = z.enum([
  "normal",
  "sensitive",
  "secret_redacted",
]);
export type EpisodicSensitivity = z.infer<typeof EpisodicSensitivitySchema>;

export const EpisodicVisibilitySchema = z.enum([
  "project_only",
  "user_private",
  "shared_candidate",
]);
export type EpisodicVisibility = z.infer<typeof EpisodicVisibilitySchema>;

export const DecisionFreshnessSchema = z.enum(["fresh", "stale"]);
export type DecisionFreshness = z.infer<typeof DecisionFreshnessSchema>;

export const RuntimePreferenceModeSchema = z.enum(["time_bounded", "tentative"]);
export type RuntimePreferenceMode = z.infer<typeof RuntimePreferenceModeSchema>;

export const ContradictionScoreSchema = z.enum(["low", "medium", "high"]);
export type ContradictionScore = z.infer<typeof ContradictionScoreSchema>;

function addScopeRefIssues(
  ctx: z.RefinementCtx,
  scope: string,
  projectRef: string | undefined,
  path: (string | number)[] = ["project_ref"],
): void {
  if (scope === "project" && !projectRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "project scope requires project_ref",
      path,
    });
  }
  if (scope !== "project" && projectRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "project_ref is only valid for project scope",
      path,
    });
  }
}

function addDeletedLifecycleIssue(
  ctx: z.RefinementCtx,
  lifecycleState: string,
  deletedAt: string | undefined,
  deletedReason: string | undefined,
): void {
  if (lifecycleState === "deleted") {
    if (!deletedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "deleted lifecycle_state requires deleted_at",
        path: ["deleted_at"],
      });
    }
    if (!deletedReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "deleted lifecycle_state requires deleted_reason",
        path: ["deleted_reason"],
      });
    }
  }
}

export const DecisionOptionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    tradeoffs: z.array(z.string()),
    evidence_refs: z.array(z.string()),
    rejected: z.boolean().optional(),
    rejection_reason: z.string().optional(),
  })
  .strict();

export type DecisionOption = z.infer<typeof DecisionOptionSchema>;

export const UnresolvedDecisionSchema = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1),
    status: z.enum(["open", "decided", "abandoned"]),
    blocking_goal_id: z.string().min(1).optional(),
    scope: ScopeKindSchema,
    options: z.array(DecisionOptionSchema).min(1),
    selected_option_id: z.string().min(1).optional(),
    urgency: z.enum(["low", "medium", "high"]),
    owner: z.enum(["user", "agent", "shared"]),
    decision_due: z.string().datetime().optional(),
    created_at: z.string().datetime(),
    last_touched_at: z.string().datetime(),
    provenance: z.array(z.string()),
  })
  .strict();

export type UnresolvedDecision = z.infer<typeof UnresolvedDecisionSchema>;

export const CurrentDecisionLeaningSchema = z
  .object({
    decision_id: z.string().min(1),
    option_id: z.string().min(1),
    observed_at: z.string().datetime(),
    source_signal_id: z.string().min(1),
    freshness: DecisionFreshnessSchema,
  })
  .strict();

export type CurrentDecisionLeaning = z.infer<typeof CurrentDecisionLeaningSchema>;

export const RuntimePreferenceContextSchema = z
  .object({
    goal_id: z.string().min(1).optional(),
    session_id: z.string().min(1).optional(),
    branch: z.string().min(1).optional(),
    file_globs: z.array(z.string()).optional(),
    task_label: z.string().min(1).optional(),
  })
  .strict();

export type RuntimePreferenceContext = z.infer<typeof RuntimePreferenceContextSchema>;

export const RuntimePreferencePromotionEvidenceSchema = z
  .object({
    explicit_confirmation_signal_id: z.string().min(1).optional(),
    repetition_count: z.number().int().nonnegative(),
    independent_sessions: z.number().int().nonnegative(),
    no_contradiction_days: z.number().int().nonnegative().optional(),
  })
  .strict();

export type RuntimePreferencePromotionEvidence = z.infer<
  typeof RuntimePreferencePromotionEvidenceSchema
>;

export const RuntimePreferenceCandidateSchema = z
  .object({
    id: z.string().min(1),
    statement: z.string().min(1),
    mode: RuntimePreferenceModeSchema,
    scope: ScopeKindSchema,
    project_ref: z.string().min(1).optional(),
    context: RuntimePreferenceContextSchema,
    status: z.enum(["active", "expired", "contradicted", "promoted", "abandoned"]),
    expires_at: z.string().datetime().optional(),
    first_observed_at: z.string().datetime(),
    last_observed_at: z.string().datetime(),
    source_signal_ids: z.array(z.string()),
    confidence: RuntimeConfidenceSchema,
    promotion_evidence: RuntimePreferencePromotionEvidenceSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    addScopeRefIssues(ctx, value.scope, value.project_ref);
  });

export type RuntimePreferenceCandidate = z.infer<typeof RuntimePreferenceCandidateSchema>;

export const RuntimeCrystalLineageSchema = z
  .object({
    generated_by: z.enum(["user", "agent", "tool"]),
    transform_id: z.string().min(1).optional(),
    prompt_version: z.string().min(1).optional(),
    model_version: z.string().min(1).optional(),
  })
  .strict();

export type RuntimeCrystalLineage = z.infer<typeof RuntimeCrystalLineageSchema>;

export const RuntimeCrystalCandidateSchema = z
  .object({
    id: z.string().min(1),
    claim: z.string().min(1),
    status: z.enum(["active", "supported", "refuted", "stale", "promoted", "abandoned"]),
    scope: ScopeKindSchema,
    project_ref: z.string().min(1).optional(),
    related_goal_ids: z.array(z.string()),
    related_decision_ids: z.array(z.string()),
    supporting_evidence_refs: z.array(z.string()),
    contradicting_evidence_refs: z.array(z.string()),
    predicted_observations: z.array(z.string()),
    successful_predictions: z.array(z.string()),
    failed_predictions: z.array(z.string()),
    confidence: RuntimeConfidenceSchema,
    contradiction_score: ContradictionScoreSchema,
    pinned: z.boolean(),
    first_observed_at: z.string().datetime(),
    last_referenced_at: z.string().datetime(),
    last_tested_at: z.string().datetime().optional(),
    source_signal_ids: z.array(z.string()),
    lineage: RuntimeCrystalLineageSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    addScopeRefIssues(ctx, value.scope, value.project_ref);
  });

export type RuntimeCrystalCandidate = z.infer<typeof RuntimeCrystalCandidateSchema>;

export const HarnessOperationalStateSchema = z
  .object({
    id: z.string().min(1),
    harness: z.string().min(1),
    instance_id: z.string().min(1).optional(),
    project_ref: z.string().min(1).optional(),
    session_id: z.string().min(1).optional(),
    status: z.enum(["active", "degraded", "unavailable", "closed"]),
    cwd: z.string().optional(),
    branch: z.string().optional(),
    active_files: z.array(z.string()).optional(),
    loaded_context_refs: z.array(z.string()).optional(),
    configured_capabilities: z.array(z.string()).optional(),
    blockers: z.array(z.string()).optional(),
    last_successful_action: z.string().optional(),
    last_failed_action: z.string().optional(),
    next_agent_instruction: z.string().optional(),
    observed_at: z.string().datetime(),
    expires_at: z.string().datetime().optional(),
    source_signal_ids: z.array(z.string()),
  })
  .strict();

export type HarnessOperationalState = z.infer<typeof HarnessOperationalStateSchema>;

export const RejectedSignalLogSchema = z
  .object({
    rejected_signal_id: z.string().min(1),
    timestamp: z.string().datetime(),
    reason_code: z.string().min(1),
    source_surface: z.string().min(1),
    scope: ScopeKindSchema,
    redacted_excerpt: z.string().optional(),
    source_hash: z.string().min(1),
  })
  .strict();

export type RejectedSignalLog = z.infer<typeof RejectedSignalLogSchema>;

export const EpisodicRelatedEntitiesSchema = z
  .object({
    goal_ids: z.array(z.string()).optional(),
    decision_ids: z.array(z.string()).optional(),
    preference_ids: z.array(z.string()).optional(),
    hypothesis_ids: z.array(z.string()).optional(),
    session_ids: z.array(z.string()).optional(),
    tool_attempt_ids: z.array(z.string()).optional(),
  })
  .strict();

export type EpisodicRelatedEntities = z.infer<typeof EpisodicRelatedEntitiesSchema>;

export const EpisodicProvenanceSchema = z
  .object({
    transform_id: z.string().min(1).optional(),
    prompt_version: z.string().min(1).optional(),
    model_version: z.string().min(1).optional(),
    cache_key: z.string().min(1).optional(),
  })
  .strict();

export type EpisodicProvenance = z.infer<typeof EpisodicProvenanceSchema>;

export const EpisodicAccessStatsSchema = z
  .object({
    last_accessed_at: z.string().datetime().optional(),
    access_count: z.number().int().nonnegative().optional(),
  })
  .strict();

export type EpisodicAccessStats = z.infer<typeof EpisodicAccessStatsSchema>;

export const EpisodicFrameSchema = z
  .object({
    id: z.string().min(1),
    event_type: EpisodicEventTypeSchema,
    summary: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(z.string()),
    attributes: z.record(z.string(), z.unknown()).optional(),
    scope: ScopeKindSchema,
    project_ref: z.string().min(1).optional(),
    curation_mode: CurationModeSchema,
    occurred_at: z.string().datetime(),
    recorded_at: z.string().datetime(),
    source_signals: z.array(z.string()),
    related_entities: EpisodicRelatedEntitiesSchema,
    evidence_refs: z.array(z.string()),
    provenance: EpisodicProvenanceSchema,
    confidence: RuntimeConfidenceSchema,
    source: RuntimeSourceSchema,
    sensitivity: EpisodicSensitivitySchema,
    visibility: EpisodicVisibilitySchema,
    pinned: z.boolean(),
    lifecycle_state: EpisodicLifecycleStateSchema,
    dormant_snapshot_id: z.string().min(1).optional(),
    access_stats: EpisodicAccessStatsSchema.optional(),
    embedding: z.array(z.number()).optional(),
    superseded_by: z.string().min(1).optional(),
    deleted_at: z.string().datetime().optional(),
    deleted_reason: z.string().min(1).optional(),
    deletion_verified_at: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    addScopeRefIssues(ctx, value.scope, value.project_ref);
    addDeletedLifecycleIssue(
      ctx,
      value.lifecycle_state,
      value.deleted_at,
      value.deleted_reason,
    );
  });

export type EpisodicFrame = z.infer<typeof EpisodicFrameSchema>;

export const DormantSnapshotEncodingContextSchema = z
  .object({
    project_ref: z.string().min(1).optional(),
    goal_ids: z.array(z.string()),
    session_ids: z.array(z.string()),
    task_label: z.string().min(1).optional(),
    abstraction_level: z.number().int().min(1).max(5).optional(),
    expected_horizon: z
      .enum(["minutes", "hours", "days", "weeks", "months"])
      .optional(),
  })
  .strict();

export type DormantSnapshotEncodingContext = z.infer<
  typeof DormantSnapshotEncodingContextSchema
>;

export const DormantSnapshotRelatedEntitiesSchema = z
  .object({
    goal_ids: z.array(z.string()),
    decision_ids: z.array(z.string()),
    hypothesis_ids: z.array(z.string()),
  })
  .strict();

export type DormantSnapshotRelatedEntities = z.infer<
  typeof DormantSnapshotRelatedEntitiesSchema
>;

export const DormantSnapshotActivationHistorySchema = z
  .object({
    times_activated: z.number().int().nonnegative(),
    last_activated_at: z.string().datetime().optional(),
  })
  .strict();

export type DormantSnapshotActivationHistory = z.infer<
  typeof DormantSnapshotActivationHistorySchema
>;

export const DormantSnapshotGeneratedBySchema = z
  .object({
    transform_id: z.string().min(1),
    prompt_version: z.string().min(1).optional(),
    model_version: z.string().min(1).optional(),
    cache_key: z.string().min(1),
  })
  .strict();

export type DormantSnapshotGeneratedBy = z.infer<typeof DormantSnapshotGeneratedBySchema>;

export const DormantSnapshotSchema = z
  .object({
    frame_id: z.string().min(1),
    snapshot_version: z.number().int().positive(),
    event_type: EpisodicEventTypeSchema,
    summary_compressed: z.string().min(1),
    key_terms: z.array(z.string()),
    encoding_context: DormantSnapshotEncodingContextSchema,
    related_entities_compressed: DormantSnapshotRelatedEntitiesSchema,
    occurred_at: z.string().datetime(),
    dormancy_entered_at: z.string().datetime(),
    embedding: z.array(z.number()),
    source: RuntimeSourceSchema,
    confidence_at_dormancy: RuntimeConfidenceSchema,
    activation_history: DormantSnapshotActivationHistorySchema,
    generated_by: DormantSnapshotGeneratedBySchema,
  })
  .strict();

export type DormantSnapshot = z.infer<typeof DormantSnapshotSchema>;

export const RUNTIME_ENTITY_REGISTRY = [
  { kind: "unresolved-decision", schemaName: "UnresolvedDecision" },
  { kind: "runtime-preference-candidate", schemaName: "RuntimePreferenceCandidate" },
  { kind: "runtime-crystal-candidate", schemaName: "RuntimeCrystalCandidate" },
  { kind: "harness-operational-state", schemaName: "HarnessOperationalState" },
  { kind: "rejected-signal-log", schemaName: "RejectedSignalLog" },
  { kind: "episodic-frame", schemaName: "EpisodicFrame" },
  { kind: "dormant-snapshot", schemaName: "DormantSnapshot" },
] as const;

export type RuntimeEntityKind = (typeof RUNTIME_ENTITY_REGISTRY)[number]["kind"];
export type RuntimeEntitySchemaName = (typeof RUNTIME_ENTITY_REGISTRY)[number]["schemaName"];

export const RUNTIME_ENTITY_KINDS = RUNTIME_ENTITY_REGISTRY.map(
  (entry) => entry.kind,
) as RuntimeEntityKind[];

export const RUNTIME_ENTITY_SCHEMA_NAMES = RUNTIME_ENTITY_REGISTRY.map(
  (entry) => entry.schemaName,
) as RuntimeEntitySchemaName[];

const RUNTIME_ENTITY_SCHEMA_BY_KIND = Object.fromEntries(
  RUNTIME_ENTITY_REGISTRY.map((entry) => [entry.kind, entry.schemaName]),
) as Record<RuntimeEntityKind, RuntimeEntitySchemaName>;

/** True when `value` is a supported runtime entity kind slug for CLI inspect. */
export function isRuntimeEntityKind(value: string): value is RuntimeEntityKind {
  return Object.hasOwn(RUNTIME_ENTITY_SCHEMA_BY_KIND, value);
}

/** Resolve the PascalCase schema name for a runtime entity kind slug. */
export function runtimeEntitySchemaNameForKind(kind: RuntimeEntityKind): RuntimeEntitySchemaName {
  return RUNTIME_ENTITY_SCHEMA_BY_KIND[kind];
}

export type RuntimeEntityParseResult<T> =
  | { success: true; value: T }
  | { success: false; error: string; issues?: z.ZodIssue[] };

function createParseHelpers<T>(
  schema: z.ZodType<T>,
): {
  parse: (input: unknown) => T;
  safeParse: (input: unknown) => RuntimeEntityParseResult<T>;
} {
  return {
    parse: (input: unknown) => schema.parse(input),
    safeParse: (input: unknown) => {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        return {
          success: false,
          error: parsed.error.message,
          issues: parsed.error.issues,
        };
      }
      return { success: true, value: parsed.data };
    },
  };
}

const unresolvedDecisionHelpers = createParseHelpers(UnresolvedDecisionSchema);
export const parseUnresolvedDecision = unresolvedDecisionHelpers.parse;
export const safeParseUnresolvedDecision = unresolvedDecisionHelpers.safeParse;

const currentDecisionLeaningHelpers = createParseHelpers(CurrentDecisionLeaningSchema);
export const parseCurrentDecisionLeaning = currentDecisionLeaningHelpers.parse;
export const safeParseCurrentDecisionLeaning = currentDecisionLeaningHelpers.safeParse;

const runtimePreferenceCandidateHelpers = createParseHelpers(
  RuntimePreferenceCandidateSchema,
);
export const parseRuntimePreferenceCandidate = runtimePreferenceCandidateHelpers.parse;
export const safeParseRuntimePreferenceCandidate =
  runtimePreferenceCandidateHelpers.safeParse;

const runtimeCrystalCandidateHelpers = createParseHelpers(RuntimeCrystalCandidateSchema);
export const parseRuntimeCrystalCandidate = runtimeCrystalCandidateHelpers.parse;
export const safeParseRuntimeCrystalCandidate = runtimeCrystalCandidateHelpers.safeParse;

const harnessOperationalStateHelpers = createParseHelpers(HarnessOperationalStateSchema);
export const parseHarnessOperationalState = harnessOperationalStateHelpers.parse;
export const safeParseHarnessOperationalState = harnessOperationalStateHelpers.safeParse;

const rejectedSignalLogHelpers = createParseHelpers(RejectedSignalLogSchema);
export const parseRejectedSignalLog = rejectedSignalLogHelpers.parse;
export const safeParseRejectedSignalLog = rejectedSignalLogHelpers.safeParse;

const episodicFrameHelpers = createParseHelpers(EpisodicFrameSchema);
export const parseEpisodicFrame = episodicFrameHelpers.parse;
export const safeParseEpisodicFrame = episodicFrameHelpers.safeParse;

const dormantSnapshotHelpers = createParseHelpers(DormantSnapshotSchema);
export const parseDormantSnapshot = dormantSnapshotHelpers.parse;
export const safeParseDormantSnapshot = dormantSnapshotHelpers.safeParse;
