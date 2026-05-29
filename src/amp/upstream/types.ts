/**
 * Upstream sync protocol types (AMP §16).
 *
 * Falsifiable claim: upstream manifests, changesets, and payloads validate with
 * strict unknown-key rejection and inferred TypeScript types.
 */

import { z } from "zod";

import { CanonicalProcedureSchema } from "../procedural/schema.js";
import { ProcedureConflictSchema } from "../procedural/schema.js";

export const UpstreamRiskClassSchema = z.enum(["low", "medium", "high"]);
export type UpstreamRiskClass = z.infer<typeof UpstreamRiskClassSchema>;

export const UpstreamSourceKindSchema = z.enum([
  "git-repo",
  "mcp-tools-manifest",
  "registry-url",
]);
export type UpstreamSourceKind = z.infer<typeof UpstreamSourceKindSchema>;

export const UpstreamConflictPolicySchema = z.enum([
  "local-wins",
  "upstream-wins",
  "prompt",
]);
export type UpstreamConflictPolicy = z.infer<typeof UpstreamConflictPolicySchema>;

export const UpstreamManifestProcedureSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    checksum: z.string().min(1),
    updated_at: z.string().datetime(),
  })
  .strict();

export type UpstreamManifestProcedure = z.infer<typeof UpstreamManifestProcedureSchema>;

export const SchemaChangeSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    breaking: z.boolean().default(true),
  })
  .strict();

export type SchemaChange = z.infer<typeof SchemaChangeSchema>;

export const UpstreamManifestSchema = z
  .object({
    sourceId: z.string().min(1),
    fetchedAt: z.string().datetime(),
    ref: z.string().min(1),
    procedures: z.array(UpstreamManifestProcedureSchema),
    schemaChanges: z.array(SchemaChangeSchema).optional(),
  })
  .strict();

export type UpstreamManifest = z.infer<typeof UpstreamManifestSchema>;

export const ProcedureRefSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
  })
  .strict();

export type ProcedureRef = z.infer<typeof ProcedureRefSchema>;

export const UpdatedProcedureRefSchema = z
  .object({
    id: z.string().min(1),
    localVersion: z.string().min(1),
    upstreamVersion: z.string().min(1),
    diffSummary: z.string().min(1),
    diffUnified: z.string(),
    riskClass: UpstreamRiskClassSchema,
  })
  .strict();

export type UpdatedProcedureRef = z.infer<typeof UpdatedProcedureRefSchema>;

export const BreakingChangeSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    riskClass: UpstreamRiskClassSchema,
  })
  .strict();

export type BreakingChange = z.infer<typeof BreakingChangeSchema>;

export const ConflictRefSchema = z
  .object({
    procedureId: z.string().min(1),
    conflict: ProcedureConflictSchema,
    localUpdatedAt: z.string().datetime(),
    upstreamUpdatedAt: z.string().datetime(),
  })
  .strict();

export type ConflictRef = z.infer<typeof ConflictRefSchema>;

export const UpstreamChangesetSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    detectedAt: z.string().datetime(),
    ref: z
      .object({
        local: z.string().min(1),
        upstream: z.string().min(1),
      })
      .strict(),
    added: z.array(ProcedureRefSchema),
    updated: z.array(UpdatedProcedureRefSchema),
    removed: z.array(ProcedureRefSchema),
    breakingChanges: z.array(BreakingChangeSchema),
    conflictsWithLocalEdits: z.array(ConflictRefSchema),
    riskClass: UpstreamRiskClassSchema,
  })
  .strict();

export type UpstreamChangeset = z.infer<typeof UpstreamChangesetSchema>;

export const UpstreamChangesetStatusSchema = z.enum(["pending", "applied", "dismissed"]);
export type UpstreamChangesetStatus = z.infer<typeof UpstreamChangesetStatusSchema>;

export const PersistedUpstreamChangesetSchema = UpstreamChangesetSchema.extend({
  status: UpstreamChangesetStatusSchema.default("pending"),
  appliedAt: z.string().datetime().optional(),
  dismissedAt: z.string().datetime().optional(),
}).strict();

export type PersistedUpstreamChangeset = z.infer<typeof PersistedUpstreamChangesetSchema>;

export const UpstreamPayloadSchema = z
  .object({
    ref: z.string().min(1),
    procedures: z.record(z.string(), CanonicalProcedureSchema),
  })
  .strict();

export type UpstreamPayload = z.infer<typeof UpstreamPayloadSchema>;

export const UpstreamSyncResultSchema = z
  .object({
    sourceId: z.string().min(1),
    driftDetected: z.boolean(),
    changesetId: z.string().optional(),
    skippedReason: z.string().optional(),
  })
  .strict();

export type UpstreamSyncResult = z.infer<typeof UpstreamSyncResultSchema>;

export const ApplyResultSchema = z
  .object({
    changesetId: z.string().min(1),
    applied: z.array(z.string()),
    skipped: z.array(z.string()),
    ok: z.boolean(),
    error: z.string().optional(),
  })
  .strict();

export type ApplyResult = z.infer<typeof ApplyResultSchema>;

export interface UpstreamSourceConfig {
  url: string;
  ref?: string;
  poll?: string;
  policy?: UpstreamConflictPolicy;
}

/** Read-only upstream source contract (AMP §16.2). */
export interface UpstreamSource {
  id: string;
  kind: UpstreamSourceKind;
  config: UpstreamSourceConfig;
  manifest(): Promise<UpstreamManifest>;
  pollUpstream(): Promise<UpstreamManifest>;
  fetch(ref: string): Promise<UpstreamPayload>;
}

export function parseUpstreamManifest(input: unknown): UpstreamManifest {
  return UpstreamManifestSchema.parse(input);
}

export function parseUpstreamChangeset(input: unknown): UpstreamChangeset {
  return UpstreamChangesetSchema.parse(input);
}

export function parsePersistedUpstreamChangeset(input: unknown): PersistedUpstreamChangeset {
  return PersistedUpstreamChangesetSchema.parse(input);
}
