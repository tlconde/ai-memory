/**
 * Typed runtime entity → formatter registry (RUNTIME-05 / RUNTIME-05-FIX).
 *
 * Falsifiable claim: every RUNTIME_ENTITY_REGISTRY kind and the
 * current-decision-leaning sub-entity resolve to schema, parse, policy, and
 * typed projection formatting via formatRuntimeEntityForProjection without
 * storage wiring.
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

export interface FormatterEntityByKind {
  "unresolved-decision": UnresolvedDecision;
  "current-decision-leaning": CurrentDecisionLeaning;
  "runtime-preference-candidate": RuntimePreferenceCandidate;
  "runtime-crystal-candidate": RuntimeCrystalCandidate;
  "harness-operational-state": HarnessOperationalState;
  "rejected-signal-log": RejectedSignalLog;
  "episodic-frame": EpisodicFrame;
  "dormant-snapshot": DormantSnapshot;
}

export interface FormatterOptionsByKind {
  "unresolved-decision": FormatUnresolvedDecisionOptions | undefined;
  "current-decision-leaning": undefined;
  "runtime-preference-candidate": FormatRuntimePreferenceOptions | undefined;
  "runtime-crystal-candidate": undefined;
  "harness-operational-state": FormatHarnessOperationalOptions | undefined;
  "rejected-signal-log": undefined;
  "episodic-frame": FormatEpisodicFrameOptions | undefined;
  "dormant-snapshot": undefined;
}

export interface FormatterPolicy {
  projectionEligibility: ProjectionEligibility;
  sensitivityPolicy: SensitivityPolicy;
  renderable: boolean;
  subEntity?: FormatterSubEntityMetadata;
}

export interface RuntimeFormatterRegistryEntry {
  kind: FormatterRegistryKind;
  schemaName: FormatterRegistrySchemaName;
  schema: z.ZodType;
  safeParse: (input: unknown) => RuntimeEntityParseResult<unknown>;
  policy: FormatterPolicy;
}

export type FormatRuntimeEntityProjectionFailureReason =
  | "unknown_kind"
  | "not_projectable"
  | "not_renderable"
  | "invalid_input";

export type FormatRuntimeEntityForProjectionResult =
  | { ok: true; formatted: RuntimeProjectionFormat | null }
  | {
      ok: false;
      error: string;
      reason: FormatRuntimeEntityProjectionFailureReason;
    };

interface EntitySchemaBundle<K extends FormatterRegistryKind> {
  schema: z.ZodType<FormatterEntityByKind[K]>;
  safeParse: (input: unknown) => RuntimeEntityParseResult<FormatterEntityByKind[K]>;
  format?: (
    entity: FormatterEntityByKind[K],
    options?: FormatterOptionsByKind[K],
  ) => RuntimeProjectionFormat | null;
}

const DEFAULT_FORMATTER_POLICY = {
  projectionEligibility: "both",
  sensitivityPolicy: "none",
  renderable: true,
} as const satisfies FormatterPolicy;

const FORMATTER_POLICY_BY_KIND = {
  "unresolved-decision": DEFAULT_FORMATTER_POLICY,
  "runtime-preference-candidate": DEFAULT_FORMATTER_POLICY,
  "runtime-crystal-candidate": DEFAULT_FORMATTER_POLICY,
  "harness-operational-state": DEFAULT_FORMATTER_POLICY,
  "episodic-frame": {
    projectionEligibility: "both",
    sensitivityPolicy: "respect_episodic_sensitivity",
    renderable: true,
  },
  "rejected-signal-log": {
    projectionEligibility: "never",
    sensitivityPolicy: "audit_metadata_only",
    renderable: true,
  },
  "dormant-snapshot": {
    projectionEligibility: "never",
    sensitivityPolicy: "none",
    renderable: false,
  },
  "current-decision-leaning": {
    projectionEligibility: "never",
    sensitivityPolicy: "none",
    renderable: false,
    subEntity: {
      parentKind: "unresolved-decision",
      standaloneProjection: false,
    },
  },
} as const satisfies Record<FormatterRegistryKind, FormatterPolicy>;

const ENTITY_SCHEMA_BUNDLES = {
  "unresolved-decision": {
    schema: UnresolvedDecisionSchema,
    safeParse: safeParseUnresolvedDecision,
    format: formatUnresolvedDecisionForRuntime,
  },
  "runtime-preference-candidate": {
    schema: RuntimePreferenceCandidateSchema,
    safeParse: safeParseRuntimePreferenceCandidate,
    format: formatRuntimePreferenceCandidateForRuntime,
  },
  "runtime-crystal-candidate": {
    schema: RuntimeCrystalCandidateSchema,
    safeParse: safeParseRuntimeCrystalCandidate,
    format: formatRuntimeCrystalCandidateForRuntime,
  },
  "harness-operational-state": {
    schema: HarnessOperationalStateSchema,
    safeParse: safeParseHarnessOperationalState,
    format: formatHarnessOperationalStateForRuntime,
  },
  "rejected-signal-log": {
    schema: RejectedSignalLogSchema,
    safeParse: safeParseRejectedSignalLog,
    format: formatRejectedSignalLogForRuntime,
  },
  "episodic-frame": {
    schema: EpisodicFrameSchema,
    safeParse: safeParseEpisodicFrame,
    format: formatEpisodicFrameForRuntime,
  },
  "dormant-snapshot": {
    schema: DormantSnapshotSchema,
    safeParse: safeParseDormantSnapshot,
  },
} as const satisfies {
  [K in RuntimeEntityKind]: EntitySchemaBundle<K>;
};

const SUB_ENTITY_SCHEMA_BUNDLES = {
  "current-decision-leaning": {
    schemaName: "CurrentDecisionLeaning",
    schema: CurrentDecisionLeaningSchema,
    safeParse: safeParseCurrentDecisionLeaning,
  },
} as const satisfies {
  [K in "current-decision-leaning"]: {
    schemaName: "CurrentDecisionLeaning";
    schema: z.ZodType<FormatterEntityByKind[K]>;
    safeParse: (input: unknown) => RuntimeEntityParseResult<FormatterEntityByKind[K]>;
  };
};

function buildRegistryEntry(
  registryRow: (typeof RUNTIME_ENTITY_REGISTRY)[number],
): RuntimeFormatterRegistryEntry {
  const kind = registryRow.kind;
  const bundle = ENTITY_SCHEMA_BUNDLES[kind];
  return {
    kind,
    schemaName: registryRow.schemaName,
    schema: bundle.schema,
    safeParse: bundle.safeParse,
    policy: FORMATTER_POLICY_BY_KIND[kind],
  };
}

const entityRegistryEntries = RUNTIME_ENTITY_REGISTRY.map((row) => buildRegistryEntry(row));

const subEntityRegistryEntry: RuntimeFormatterRegistryEntry = {
  kind: "current-decision-leaning",
  schemaName: SUB_ENTITY_SCHEMA_BUNDLES["current-decision-leaning"].schemaName,
  schema: SUB_ENTITY_SCHEMA_BUNDLES["current-decision-leaning"].schema,
  safeParse: SUB_ENTITY_SCHEMA_BUNDLES["current-decision-leaning"].safeParse,
  policy: FORMATTER_POLICY_BY_KIND["current-decision-leaning"],
};

export const RUNTIME_FORMATTER_REGISTRY = [
  ...entityRegistryEntries,
  subEntityRegistryEntry,
] as const satisfies readonly RuntimeFormatterRegistryEntry[];

/** Stable projection eligibility map keyed by formatter registry kind. */
export const RUNTIME_FORMATTER_PROJECTION_ELIGIBILITY = Object.fromEntries(
  RUNTIME_FORMATTER_REGISTRY.map((entry) => [
    entry.kind,
    entry.policy.projectionEligibility,
  ]),
) as Record<FormatterRegistryKind, ProjectionEligibility>;

const FORMATTER_REGISTRY_BY_KIND = Object.fromEntries(
  RUNTIME_FORMATTER_REGISTRY.map((entry) => [entry.kind, entry]),
) as Record<FormatterRegistryKind, RuntimeFormatterRegistryEntry>;

export type ProjectableFormatterKind = {
  [K in FormatterRegistryKind]: (typeof FORMATTER_POLICY_BY_KIND)[K]["projectionEligibility"] extends "never"
    ? never
    : (typeof FORMATTER_POLICY_BY_KIND)[K]["renderable"] extends false
      ? never
      : K;
}[FormatterRegistryKind];

/** Kinds that may appear in standalone runtime projection materialization. */
export const PROJECTABLE_FORMATTER_KINDS = (
  Object.keys(FORMATTER_POLICY_BY_KIND) as FormatterRegistryKind[]
).filter(
  (kind): kind is ProjectableFormatterKind =>
    FORMATTER_POLICY_BY_KIND[kind].projectionEligibility !== "never" &&
    FORMATTER_POLICY_BY_KIND[kind].renderable,
);

/** Compile-time guard: every RUNTIME_ENTITY_REGISTRY kind must have schema + policy. */
type RuntimeRegistryKinds = (typeof RUNTIME_ENTITY_REGISTRY)[number]["kind"];
type PolicyMapKinds = keyof typeof FORMATTER_POLICY_BY_KIND;
type SchemaBundleKinds = keyof typeof ENTITY_SCHEMA_BUNDLES;
type AssertRuntimeKindsHavePolicy = RuntimeRegistryKinds extends PolicyMapKinds ? true : never;
type AssertRuntimeKindsHaveSchema = RuntimeRegistryKinds extends SchemaBundleKinds ? true : never;
type AssertProjectableKindsHaveFormat = ProjectableFormatterKind extends {
  [K in ProjectableFormatterKind]: (typeof ENTITY_SCHEMA_BUNDLES)[K] extends {
    format: unknown;
  }
    ? K
    : never;
}[ProjectableFormatterKind]
  ? true
  : never;
const _runtimeKindsHavePolicy: AssertRuntimeKindsHavePolicy = true;
const _runtimeKindsHaveSchema: AssertRuntimeKindsHaveSchema = true;
const _projectableKindsHaveFormat: AssertProjectableKindsHaveFormat = true;

export const FORMATTER_REGISTRY_KINDS = RUNTIME_FORMATTER_REGISTRY.map(
  (entry) => entry.kind,
) as FormatterRegistryKind[];

/** True when `value` is a supported formatter registry kind slug. */
export function isFormatterRegistryKind(value: string): value is FormatterRegistryKind {
  return Object.hasOwn(FORMATTER_REGISTRY_BY_KIND, value);
}

/** True when the kind may appear in standalone runtime projection materialization. */
export function isProjectableFormatterKind(
  kind: FormatterRegistryKind,
): kind is ProjectableFormatterKind {
  return PROJECTABLE_FORMATTER_KINDS.includes(kind as ProjectableFormatterKind);
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

function formatParsedEntityForProjection(
  kind: ProjectableFormatterKind,
  entity: FormatterEntityByKind[ProjectableFormatterKind],
  options?: unknown,
): RuntimeProjectionFormat | null {
  switch (kind) {
    case "unresolved-decision":
      return ENTITY_SCHEMA_BUNDLES[kind].format!(
        entity as UnresolvedDecision,
        options as FormatUnresolvedDecisionOptions | undefined,
      );
    case "runtime-preference-candidate":
      return ENTITY_SCHEMA_BUNDLES[kind].format!(
        entity as RuntimePreferenceCandidate,
        options as FormatRuntimePreferenceOptions | undefined,
      );
    case "runtime-crystal-candidate":
      return ENTITY_SCHEMA_BUNDLES[kind].format!(entity as RuntimeCrystalCandidate);
    case "harness-operational-state":
      return ENTITY_SCHEMA_BUNDLES[kind].format!(
        entity as HarnessOperationalState,
        options as FormatHarnessOperationalOptions | undefined,
      );
    case "episodic-frame":
      return ENTITY_SCHEMA_BUNDLES[kind].format!(
        entity as EpisodicFrame,
        options as FormatEpisodicFrameOptions | undefined,
      );
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unhandled projectable formatter kind: ${String(_exhaustive)}`);
    }
  }
}

function formatRuntimeEntityForProjectionImpl(
  kind: FormatterRegistryKind,
  input: unknown,
  options?: unknown,
): FormatRuntimeEntityForProjectionResult {
  if (!isFormatterRegistryKind(kind)) {
    return {
      ok: false,
      error: `Unknown formatter registry kind: ${kind}`,
      reason: "unknown_kind",
    };
  }

  const entry = getFormatterRegistryEntry(kind);

  if (entry.policy.projectionEligibility === "never") {
    return {
      ok: false,
      error: `${kind} is not projectable`,
      reason: "not_projectable",
    };
  }

  if (!entry.policy.renderable) {
    return {
      ok: false,
      error: `${kind} is not renderable for standalone projection`,
      reason: "not_renderable",
    };
  }

  const parsed = entry.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error,
      reason: "invalid_input",
    };
  }

  const formatted = formatParsedEntityForProjection(
    kind as ProjectableFormatterKind,
    parsed.value as FormatterEntityByKind[ProjectableFormatterKind],
    options as FormatterOptionsByKind[ProjectableFormatterKind],
  );

  return { ok: true, formatted };
}

/** Format and validate a runtime entity for projection at the registry boundary. */
export function formatRuntimeEntityForProjection(
  kind: "unresolved-decision",
  input: unknown,
  options?: FormatUnresolvedDecisionOptions,
): FormatRuntimeEntityForProjectionResult;
export function formatRuntimeEntityForProjection(
  kind: "runtime-preference-candidate",
  input: unknown,
  options?: FormatRuntimePreferenceOptions,
): FormatRuntimeEntityForProjectionResult;
export function formatRuntimeEntityForProjection(
  kind: "runtime-crystal-candidate",
  input: unknown,
): FormatRuntimeEntityForProjectionResult;
export function formatRuntimeEntityForProjection(
  kind: "harness-operational-state",
  input: unknown,
  options?: FormatHarnessOperationalOptions,
): FormatRuntimeEntityForProjectionResult;
export function formatRuntimeEntityForProjection(
  kind: "episodic-frame",
  input: unknown,
  options?: FormatEpisodicFrameOptions,
): FormatRuntimeEntityForProjectionResult;
export function formatRuntimeEntityForProjection(
  kind: FormatterRegistryKind,
  input: unknown,
  options?: unknown,
): FormatRuntimeEntityForProjectionResult;
export function formatRuntimeEntityForProjection(
  kind: FormatterRegistryKind,
  input: unknown,
  options?: unknown,
): FormatRuntimeEntityForProjectionResult {
  return formatRuntimeEntityForProjectionImpl(kind, input, options);
}

/** Boundary parse helper for untrusted runtime entity payloads. */
export function parseRuntimeEntityAtBoundary<K extends FormatterRegistryKind>(
  kind: K,
  input: unknown,
): RuntimeEntityParseResult<FormatterEntityByKind[K]> {
  const parsed = getFormatterRegistryEntry(kind).safeParse(input);
  if (!parsed.success) {
    return parsed;
  }
  return { success: true, value: parsed.value as FormatterEntityByKind[K] };
}
