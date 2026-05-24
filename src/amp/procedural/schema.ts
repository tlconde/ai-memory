/**
 * Canonical AMP procedure (skill) source schema.
 *
 * Falsifiable claim: valid procedure frontmatter plus markdown body round-trip
 * through Zod validation with provenance, compatibility, overlays, and
 * conflict metadata preserved.
 */

import { z } from "zod";

import { ScopeKindSchema } from "../core/frame-schema.js";

export const AMP_PROCEDURE_ARTIFACT_VERSION = "1.0";

export const ProcedureScopeSchema = ScopeKindSchema;
export type ProcedureScope = z.infer<typeof ProcedureScopeSchema>;

/** Procedures use personal or llm_curated curation — not shared knowledge promotion. */
export const ProcedureCurationModeSchema = z.enum(["personal", "llm_curated"]);
export type ProcedureCurationMode = z.infer<typeof ProcedureCurationModeSchema>;

export const AmpCompatibilitySchema = z
  .object({
    min_amp_version: z.string().min(1),
    required_frame_kinds: z.array(z.enum(["episodic", "semantic", "crystal"])).default([]),
    required_profile_slots: z.array(z.string().min(1)).default([]),
    required_audiences: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type AmpCompatibility = z.infer<typeof AmpCompatibilitySchema>;

export const InjectionPathSchema = z.enum(["filesystem-native", "mcp", "either"]);
export type InjectionPath = z.infer<typeof InjectionPathSchema>;

export const HarnessCompatibilitySchema = z
  .object({
    supported_harnesses: z.array(z.string().min(1)).min(1),
    injection_path: InjectionPathSchema,
  })
  .strict();

export type HarnessCompatibility = z.infer<typeof HarnessCompatibilitySchema>;

export const CursorHarnessOverlaySchema = z
  .object({
    globs: z.array(z.string()).default([]),
    alwaysApply: z.boolean().default(false),
  })
  .strict();

export const GbrainHarnessOverlaySchema = z
  .object({
    resolver_priority: z.number().int().optional(),
  })
  .strict();

export const HarnessOverlaysSchema = z
  .object({
    cursor: CursorHarnessOverlaySchema.optional(),
    claude_code: z.record(z.string(), z.unknown()).optional(),
    hermes: z.record(z.string(), z.unknown()).optional(),
    gbrain: GbrainHarnessOverlaySchema.optional(),
  })
  .strict();

export type HarnessOverlays = z.infer<typeof HarnessOverlaysSchema>;

export const ProcedureProvenanceSchema = z
  .object({
    source: z.enum(["user", "amp-registry", "import"]),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime().optional(),
    author: z.string().min(1).optional(),
    notes: z.string().optional(),
  })
  .strict();

export type ProcedureProvenance = z.infer<typeof ProcedureProvenanceSchema>;

export const ProcedureConflictSchema = z
  .object({
    with: z.string().min(1),
    reason: z.string().min(1),
    detected_at: z.string().datetime().optional(),
  })
  .strict();

export type ProcedureConflict = z.infer<typeof ProcedureConflictSchema>;

export const ProcedureFrontmatterSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    version: z.string().min(1),
    triggers: z.array(z.string()).default([]),
    tools: z.array(z.string()).default([]),
    mutating: z.boolean().default(false),
    writes_pages: z.boolean().default(false),
    writes_to: z.array(z.string()).default([]),
    amp_artifact_version: z.string().min(1).default(AMP_PROCEDURE_ARTIFACT_VERSION),
    scope: ProcedureScopeSchema,
    curation_mode: ProcedureCurationModeSchema,
    amp_compatibility: AmpCompatibilitySchema,
    harness_compatibility: HarnessCompatibilitySchema,
    harness_overlays: HarnessOverlaysSchema.default({}),
    extends: z.array(z.string().min(1)).default([]),
    required_by: z.array(z.string().min(1)).default([]),
    conflicts_with: z.array(z.string().min(1)).default([]),
    provenance: ProcedureProvenanceSchema.optional(),
    conflicts: z.array(ProcedureConflictSchema).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scope === "project" && value.name.includes("/")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "procedure name must not contain path separators",
        path: ["name"],
      });
    }
  });

export type ProcedureFrontmatter = z.infer<typeof ProcedureFrontmatterSchema>;

export const CanonicalProcedureSchema = z
  .object({
    frontmatter: ProcedureFrontmatterSchema,
    body: z.string(),
  })
  .strict();

export type CanonicalProcedure = z.infer<typeof CanonicalProcedureSchema>;

export type ProcedureParseResult =
  | { success: true; procedure: CanonicalProcedure }
  | { success: false; error: string; issues?: z.ZodIssue[] };

export function parseCanonicalProcedure(input: unknown): CanonicalProcedure {
  return CanonicalProcedureSchema.parse(input);
}

export function safeParseCanonicalProcedure(input: unknown): ProcedureParseResult {
  const parsed = CanonicalProcedureSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Procedure failed schema validation",
      issues: parsed.error.issues,
    };
  }
  return { success: true, procedure: parsed.data };
}

/** Build a minimal valid canonical procedure for tests and fixtures. */
export function createCanonicalProcedure(
  overrides: Partial<ProcedureFrontmatter> & { body?: string } = {}
): CanonicalProcedure {
  const { body = "# Procedure\n", ...frontmatterOverrides } = overrides;
  const frontmatter: ProcedureFrontmatter = {
    name: "example-procedure",
    description: "Example AMP procedure for tests.",
    version: "0.1.0",
    triggers: [],
    tools: [],
    mutating: false,
    writes_pages: false,
    writes_to: [],
    amp_artifact_version: AMP_PROCEDURE_ARTIFACT_VERSION,
    scope: "project",
    curation_mode: "personal",
    amp_compatibility: {
      min_amp_version: "1.0",
      required_frame_kinds: [],
      required_profile_slots: [],
      required_audiences: [],
    },
    harness_compatibility: {
      supported_harnesses: ["cursor"],
      injection_path: "filesystem-native",
    },
    harness_overlays: {},
    extends: [],
    required_by: [],
    conflicts_with: [],
    conflicts: [],
    ...frontmatterOverrides,
  };

  return { frontmatter, body };
}
