/**
 * AMP v1 config schema (project + user).
 *
 * Falsifiable claim: valid YAML configs round-trip through Zod validation with
 * runtime path and project_ref preserved.
 */

import { z } from "zod";

export const AMP_CONFIG_VERSION = "1.0";

export const RuntimeConfigSchema = z
  .object({
    db_path: z.string().min(1).optional(),
  })
  .strict();

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;

export const AmpConfigFileSchema = z
  .object({
    amp_config_version: z.string().min(1).optional(),
    project_ref: z.string().min(1).optional(),
    runtime: RuntimeConfigSchema.optional(),
  })
  .strict();

export type AmpConfigFile = z.infer<typeof AmpConfigFileSchema>;

export function parseAmpConfigFile(input: unknown): AmpConfigFile {
  return AmpConfigFileSchema.parse(input);
}

export function safeParseAmpConfigFile(input: unknown) {
  return AmpConfigFileSchema.safeParse(input);
}
