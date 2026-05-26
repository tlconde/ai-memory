/**
 * Typed runtime entity → formatter registry (RUNTIME-05).
 *
 * Falsifiable claim: every RUNTIME_ENTITY_REGISTRY kind and the
 * current-decision-leaning sub-entity resolve to schema, parse, projection
 * eligibility, and optional format helpers without storage wiring.
 */

import type { z } from "zod";

import {
  formatEpisodicFrameForRuntime,
  formatHarnessOperationalStateForRuntime,
  formatRejectedSignalLogForRuntime,
  formatRuntimeCrystalCandidateForRuntime,
  formatRuntimePreferenceCandidateForRuntime,
  formatUnresolvedDecisionForRuntime,
  type FormatEpisodicFrameOptions,
  type FormatHarnessOperationalOptions,
  type FormatRuntimePreferenceOptions,
  type FormatUnresolvedDecisionOptions,
  type RuntimeProjectionFormat,
} from "./format-projection.js";
import {
  CurrentDecisionLeaningSchema,
  DormantSnapshotSchema,
  EpisodicFrameSchema,
  HarnessOperationalStateSchema,
  parseCurrentDecisionLeaning,
  parseDormantSnapshot,
  parseEpisodicFrame,
  parseHarnessOperationalState,
  parseRejectedSignalLog,
  parseRuntimeCrystalCandidate,
  parseRuntimePreferenceCandidate,
  parseUnresolvedDecision,
  RejectedSignalLogSchema,
  RUNTIME_ENTITY_REGISTRY,
  RuntimeCrystalCandidateSchema,
  RuntimePreferenceCandidateSchema,
  safeParseCurrentDecisionLeaning,
  safeParseDormantSnapshot,
  safeParseEpisodicFrame,
  safeParseHarnessOperationalState,
  safeParseRejectedSignalLog,
  safeParseRuntimeCrystalCandidate,
  safeParseRuntimePreferenceCandidate,
  safeParseUnresolvedDecision,
  UnresolvedDecisionSchema,
  type CurrentDecisionLeaning,
  type DormantSnapshot,
  type EpisodicFrame,
  type HarnessOperationalState,
  type RejectedSignalLog,
  type RuntimeCrystalCandidate,
  type RuntimeEntityKind,
  type RuntimeEntityParseResult,
  type RuntimeEntitySchemaName,
  type RuntimePreferenceCandidate,
  type UnresolvedDecision,
} from "./schema.js";

export type ProjectionEligibility = "global" | "project" | "both" | "never";

export type SensitivityPolicy =
  | "none"
  | "respect_episodic_sensitivity"
  | "audit_metadata_only";

/** Registry kind slugs: all RUNTIME_ENTITY_REGISTRY kinds plus sub-entities. */
export type FormatterRegistryKind = RuntimeEntityKind | "current-decision-leaning";

export type FormatterRegistrySchemaName =
  | RuntimeEntitySchemaName
  | "CurrentDecisionLeaning";

export interface FormatterSubEntityMetadata {
  parentKind: "unresolved-decision";
  standaloneProjection: false;
}

export interface RuntimeFormatterRegistryEntry {
  kind: FormatterRegistryKind;
  schemaName: FormatterRegistrySchemaName;
  schema: z.ZodType;
  parse: (input: unknown) => unknown;
  safeParse: (input: unknown) => RuntimeEntityParseResult<unknown>;
  format?: (entity: unknown, options?: unknown) => RuntimeProjectionFormat | null;
  projectionEligibility: ProjectionEligibility;
  sensitivityPolicy?: SensitivityPolicy;
  renderable: boolean;
  subEntity?: FormatterSubEntityMetadata;
}

function createRegistryEntry<TEntity, TOptions = undefined>(
  entry: Omit<
    RuntimeFormatterRegistryEntry,
    "parse" | "safeParse" | "schema" | "format"
  > & {
    schema: z.ZodType<TEntity>;
    parse: (input: unknown) => TEntity;
    safeParse: (input: unknown) => RuntimeEntityParseResult<TEntity>;
    format?: (entity: TEntity, options?: TOptions) => RuntimeProjectionFormat | null;
  },
): RuntimeFormatterRegistryEntry {
  return {
    ...entry,
    parse: entry.parse,
    safeParse: entry.safeParse,
    format: entry.format
      ? (entity: unknown, options?: unknown) => {
          const parsed = entry.safeParse(entity);
          if (!parsed.success) {
            return null;
          }
          return entry.format!(parsed.value, options as TOptions);
        }
      : undefined,
  };
}

const unresolvedDecisionEntry = createRegistryEntry({
  kind: "unresolved-decision",
  schemaName: "UnresolvedDecision",
  schema: UnresolvedDecisionSchema,
  parse: parseUnresolvedDecision,
  safeParse: safeParseUnresolvedDecision,
  format: (
    entity: UnresolvedDecision,
    options?: FormatUnresolvedDecisionOptions,
  ) => formatUnresolvedDecisionForRuntime(entity, options),
  projectionEligibility: "both",
  sensitivityPolicy: "none",
  renderable: true,
});

const currentDecisionLeaningEntry = createRegistryEntry({
  kind: "current-decision-leaning",
  schemaName: "CurrentDecisionLeaning",
  schema: CurrentDecisionLeaningSchema,
  parse: parseCurrentDecisionLeaning,
  safeParse: safeParseCurrentDecisionLeaning,
  projectionEligibility: "never",
  sensitivityPolicy: "none",
  renderable: false,
  subEntity: {
    parentKind: "unresolved-decision",
    standaloneProjection: false,
  },
});

const runtimePreferenceCandidateEntry = createRegistryEntry({
  kind: "runtime-preference-candidate",
  schemaName: "RuntimePreferenceCandidate",
  schema: RuntimePreferenceCandidateSchema,
  parse: parseRuntimePreferenceCandidate,
  safeParse: safeParseRuntimePreferenceCandidate,
  format: (
    entity: RuntimePreferenceCandidate,
    options?: FormatRuntimePreferenceOptions,
  ) => formatRuntimePreferenceCandidateForRuntime(entity, options),
  projectionEligibility: "both",
  sensitivityPolicy: "none",
  renderable: true,
});

const runtimeCrystalCandidateEntry = createRegistryEntry({
  kind: "runtime-crystal-candidate",
  schemaName: "RuntimeCrystalCandidate",
  schema: RuntimeCrystalCandidateSchema,
  parse: parseRuntimeCrystalCandidate,
  safeParse: safeParseRuntimeCrystalCandidate,
  format: (entity: RuntimeCrystalCandidate) =>
    formatRuntimeCrystalCandidateForRuntime(entity),
  projectionEligibility: "both",
  sensitivityPolicy: "none",
  renderable: true,
});

const harnessOperationalStateEntry = createRegistryEntry({
  kind: "harness-operational-state",
  schemaName: "HarnessOperationalState",
  schema: HarnessOperationalStateSchema,
  parse: parseHarnessOperationalState,
  safeParse: safeParseHarnessOperationalState,
  format: (
    entity: HarnessOperationalState,
    options?: FormatHarnessOperationalOptions,
  ) => formatHarnessOperationalStateForRuntime(entity, options),
  projectionEligibility: "both",
  sensitivityPolicy: "none",
  renderable: true,
});

const rejectedSignalLogEntry = createRegistryEntry({
  kind: "rejected-signal-log",
  schemaName: "RejectedSignalLog",
  schema: RejectedSignalLogSchema,
  parse: parseRejectedSignalLog,
  safeParse: safeParseRejectedSignalLog,
  format: (entity: RejectedSignalLog) => formatRejectedSignalLogForRuntime(entity),
  projectionEligibility: "never",
  sensitivityPolicy: "audit_metadata_only",
  renderable: true,
});

const episodicFrameEntry = createRegistryEntry({
  kind: "episodic-frame",
  schemaName: "EpisodicFrame",
  schema: EpisodicFrameSchema,
  parse: parseEpisodicFrame,
  safeParse: safeParseEpisodicFrame,
  format: (entity: EpisodicFrame, options?: FormatEpisodicFrameOptions) =>
    formatEpisodicFrameForRuntime(entity, options),
  projectionEligibility: "both",
  sensitivityPolicy: "respect_episodic_sensitivity",
  renderable: true,
});

const dormantSnapshotEntry = createRegistryEntry({
  kind: "dormant-snapshot",
  schemaName: "DormantSnapshot",
  schema: DormantSnapshotSchema,
  parse: parseDormantSnapshot,
  safeParse: safeParseDormantSnapshot,
  projectionEligibility: "never",
  sensitivityPolicy: "none",
  renderable: false,
});

export const RUNTIME_FORMATTER_REGISTRY = [
  unresolvedDecisionEntry,
  currentDecisionLeaningEntry,
  runtimePreferenceCandidateEntry,
  runtimeCrystalCandidateEntry,
  harnessOperationalStateEntry,
  rejectedSignalLogEntry,
  episodicFrameEntry,
  dormantSnapshotEntry,
] as const satisfies readonly RuntimeFormatterRegistryEntry[];

/** Stable projection eligibility map keyed by formatter registry kind. */
export const RUNTIME_FORMATTER_PROJECTION_ELIGIBILITY = Object.fromEntries(
  RUNTIME_FORMATTER_REGISTRY.map((entry) => [entry.kind, entry.projectionEligibility]),
) as Record<FormatterRegistryKind, ProjectionEligibility>;

const FORMATTER_REGISTRY_BY_KIND = Object.fromEntries(
  RUNTIME_FORMATTER_REGISTRY.map((entry) => [entry.kind, entry]),
) as Record<FormatterRegistryKind, RuntimeFormatterRegistryEntry>;

/** Compile-time guard: every RUNTIME_ENTITY_REGISTRY kind must have a registry entry. */
type RuntimeRegistryKinds = (typeof RUNTIME_ENTITY_REGISTRY)[number]["kind"];
type FormatterRegistryEntryKinds = (typeof RUNTIME_FORMATTER_REGISTRY)[number]["kind"];
type AssertRuntimeKindsCovered = RuntimeRegistryKinds extends FormatterRegistryEntryKinds
  ? true
  : never;
const _runtimeKindsCovered: AssertRuntimeKindsCovered = true;

export const FORMATTER_REGISTRY_KINDS = RUNTIME_FORMATTER_REGISTRY.map(
  (entry) => entry.kind,
) as FormatterRegistryKind[];

/** True when `value` is a supported formatter registry kind slug. */
export function isFormatterRegistryKind(value: string): value is FormatterRegistryKind {
  return Object.hasOwn(FORMATTER_REGISTRY_BY_KIND, value);
}

/** Resolve a formatter registry entry or throw for unknown kinds. */
export function getFormatterRegistryEntry(
  kind: FormatterRegistryKind,
): RuntimeFormatterRegistryEntry {
  const entry = FORMATTER_REGISTRY_BY_KIND[kind];
  if (!entry) {
    throw new Error(`Unknown formatter registry kind: ${kind}`);
  }
  return entry;
}

/** Resolve a formatter registry entry from an untrusted kind slug. */
export function resolveFormatterRegistryEntry(
  kind: string,
): RuntimeFormatterRegistryEntry | undefined {
  if (!isFormatterRegistryKind(kind)) {
    return undefined;
  }
  return getFormatterRegistryEntry(kind);
}

/** True when the registry entry may appear in runtime projection materialization. */
export function isProjectableFormatterKind(kind: FormatterRegistryKind): boolean {
  return getFormatterRegistryEntry(kind).projectionEligibility !== "never";
}
