/**
 * SAS (Surface Adapter Spec) declarative spec schema.
 *
 * Falsifiable claim: surface-role specs declare injection_modes, from_amp_path,
 * and emitted_artifact with strict unknown-key rejection.
 */

import { z } from "zod";

import { ExternalClaimSchema, type ExternalClaim } from "../ssa/claim-label.js";

export const SAS_ROLE = "surface" as const;

export const InjectionModeSchema = z.enum([
  "local-mcp-stdio",
  "remote-mcp",
  "filesystem-native",
  "briefing-paste",
]);
export type InjectionMode = z.infer<typeof InjectionModeSchema>;

export const EmittedArtifactFormatSchema = z.enum(["mdc", "skill-md"]);
export type EmittedArtifactFormat = z.infer<typeof EmittedArtifactFormatSchema>;

export const EmittedArtifactNamingSchema = z.enum(["flat", "folder-per-skill"]);
export type EmittedArtifactNaming = z.infer<typeof EmittedArtifactNamingSchema>;

export const EmittedArtifactSchema = z
  .object({
    format: EmittedArtifactFormatSchema,
    naming: EmittedArtifactNamingSchema,
  })
  .strict();

export type EmittedArtifact = z.infer<typeof EmittedArtifactSchema>;

export const SasSpecSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
    role: z.literal(SAS_ROLE),
    injection_modes: z.array(InjectionModeSchema).min(1),
    from_amp_path: z.string().min(1),
    emitted_artifact: EmittedArtifactSchema,
    external_claims: z.array(ExternalClaimSchema).optional(),
  })
  .strict();

export type SasSpec = z.infer<typeof SasSpecSchema>;

export type SasSpecParseResult =
  | { success: true; spec: SasSpec }
  | { success: false; error: string; issues?: z.ZodIssue[] };

export function parseSasSpec(input: unknown): SasSpecParseResult {
  const parsed = SasSpecSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.message,
      issues: parsed.error.issues,
    };
  }
  return { success: true, spec: parsed.data };
}

export function safeParseSasSpec(input: unknown): SasSpecParseResult {
  return parseSasSpec(input);
}

export type { ExternalClaim };
