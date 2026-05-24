/**
 * AMP frame wire protocol schema and validation.
 *
 * Falsifiable claim: a valid frame round-trips with kind, scope, curation_mode,
 * provenance, and schema version preserved.
 */

import { z } from "zod";

export const FRAME_SCHEMA_VERSION = "1.0";

export const FrameKindSchema = z.enum(["episodic", "semantic", "crystal"]);
export type FrameKind = z.infer<typeof FrameKindSchema>;

export const ScopeKindSchema = z.enum(["project", "user", "universal"]);
export type ScopeKind = z.infer<typeof ScopeKindSchema>;

export const CurationModeSchema = z.enum(["personal", "llm_curated", "shared"]);
export type CurationMode = z.infer<typeof CurationModeSchema>;

export const ConfidenceBasisTypeSchema = z.enum([
  "experience_confidence",
  "source_attestation",
  "deductive",
  "direct_statement",
]);

export const ProvenanceBlockSchema = z
  .object({
    surface: z.string().min(1),
    harness: z.string().optional(),
    session_id: z.string().optional(),
    captured_at: z.string().datetime().optional(),
    notes: z.string().optional(),
  })
  .strict();

export type ProvenanceBlock = z.infer<typeof ProvenanceBlockSchema>;

export const ScopeBlockSchema = z
  .object({
    kind: ScopeKindSchema,
    project_ref: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((scope, ctx) => {
    if (scope.kind === "project" && !scope.project_ref) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "project scope requires project_ref",
        path: ["project_ref"],
      });
    }
    if (scope.kind !== "project" && scope.project_ref) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "project_ref is only valid for project scope",
        path: ["project_ref"],
      });
    }
  });

export type ScopeBlock = z.infer<typeof ScopeBlockSchema>;

export const KindProvenanceSchema = z
  .object({
    default_inferred: FrameKindSchema,
    default_basis: z.string(),
    user_override: FrameKindSchema.nullable(),
    override_reason: z.string().nullable(),
    final_kind_source: z.enum(["default", "user_override"]),
  })
  .strict();

export const ConfidenceBasisSchema = z
  .object({
    type: ConfidenceBasisTypeSchema,
    iterations: z.number().int().nonnegative().optional(),
    observation_period: z
      .object({
        first: z.string().datetime(),
        most_recent: z.string().datetime(),
      })
      .strict()
      .optional(),
    notes: z.string().optional(),
  })
  .strict();

export const FrameSchema = z
  .object({
    schema_version: z.string().default(FRAME_SCHEMA_VERSION),
    id: z.string().min(1),
    kind: FrameKindSchema,
    content: z.union([z.string(), z.record(z.string(), z.unknown())]),
    source: ProvenanceBlockSchema,
    created_at: z.string().datetime(),
    scope: ScopeBlockSchema,
    curation_mode: CurationModeSchema,
    valid_from: z.string().datetime().optional(),
    valid_until: z.string().datetime().nullable().optional(),
    supersedes: z.array(z.string().min(1)).optional(),
    superseded_by: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1).optional(),
    confidence_basis: ConfidenceBasisSchema.optional(),
    kind_provenance: KindProvenanceSchema.optional(),
    correction_of: z.string().min(1).optional(),
    conditions: z.array(z.record(z.string(), z.unknown())).optional(),
    refutations: z.array(z.string().min(1)).optional(),
    refinement_history: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .superRefine((frame, ctx) => {
    if (frame.correction_of && frame.kind !== "episodic") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "correction_of is only valid on episodic frames",
        path: ["correction_of"],
      });
    }
  });

export type Frame = z.infer<typeof FrameSchema>;

export type FrameParseResult =
  | { success: true; frame: Frame }
  | { success: false; error: string };

/** Parse and validate unknown input as an AMP frame. */
export function parseFrame(input: unknown): FrameParseResult {
  const parsed = FrameSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }
  return { success: true, frame: parsed.data };
}

/** Serialize a validated frame to JSON-compatible wire format. */
export function serializeFrame(frame: Frame): Record<string, unknown> {
  const validated = FrameSchema.parse(frame);
  return structuredClone(validated) as Record<string, unknown>;
}

/** Round-trip parse → serialize → parse; returns false if any field drifts. */
export function frameRoundTripPreserves(input: Frame): boolean {
  const first = parseFrame(input);
  if (!first.success) return false;

  const wire = serializeFrame(first.frame);
  const second = parseFrame(wire);
  if (!second.success) return false;

  return JSON.stringify(first.frame) === JSON.stringify(second.frame);
}

/** Create a frame with schema defaults applied (including schema_version). */
export function createFrame(input: unknown): Frame {
  return FrameSchema.parse(input);
}
