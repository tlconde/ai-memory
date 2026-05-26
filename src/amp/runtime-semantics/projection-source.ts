/**
 * Typed runtime semantic entity source adapter (RUNTIME-06).
 *
 * Falsifiable claim: in-memory runtime entity records convert to projection-
 * ready formatted text via formatRuntimeEntityForProjection without storage or
 * .amp/local/runtime.md wiring.
 */

import type { ScopeKind } from "../core/frame-schema.js";
import {
  formatRuntimeEntityForProjection,
  isProjectableFormatterKind,
  parseRuntimeEntityAtBoundary,
  type FormatRuntimeEntityProjectionFailureReason,
  type FormatterRegistryKind,
  type ProjectableFormatterKind,
} from "./formatter-registry.js";
import {
  joinRuntimeProjectionLines,
  type RuntimeProjectionFormat,
} from "./format-projection.js";
import type { CurrentDecisionLeaning } from "./schema.js";

export type RuntimeFormatterRegistryKind = FormatterRegistryKind;

export interface RuntimeSemanticEntityRecord {
  id: string;
  kind: RuntimeFormatterRegistryKind;
  scope: ScopeKind;
  project_ref?: string;
  payload: unknown;
  observed_at?: string;
}

export interface RuntimeSemanticEntitySource {
  listEntities(): readonly RuntimeSemanticEntityRecord[];
}

export class InMemoryRuntimeSemanticEntitySource implements RuntimeSemanticEntitySource {
  constructor(private readonly entities: readonly RuntimeSemanticEntityRecord[]) {}

  listEntities(): readonly RuntimeSemanticEntityRecord[] {
    return this.entities;
  }
}

export type RuntimeProjectionTargetSection = "globalRuntime" | "projectRuntime";

export interface RuntimeProjectionMaterializedItem {
  id: string;
  kind: ProjectableFormatterKind;
  section: RuntimeProjectionTargetSection;
  formatted: RuntimeProjectionFormat;
  text: string;
}

export type RuntimeProjectionMaterializationSkipReason =
  | FormatRuntimeEntityProjectionFailureReason
  | "scope_mismatch"
  | "record_payload_scope_mismatch"
  | "record_payload_project_ref_mismatch"
  | "missing_record_project_ref"
  | "orphan_sub_entity"
  | "invalid_sub_entity"
  | "empty_format";

export interface RuntimeProjectionMaterializationSkip {
  recordId: string;
  kind: RuntimeFormatterRegistryKind;
  reason: RuntimeProjectionMaterializationSkipReason;
  message: string;
}

export interface MaterializeRuntimeProjectionFromSourceOptions {
  projectRef: string;
}

export interface MaterializeRuntimeProjectionFromSourceResult {
  items: RuntimeProjectionMaterializedItem[];
  skipped: RuntimeProjectionMaterializationSkip[];
}

/** Resolve which runtime projection section an entity belongs in for a project. */
export function resolveRuntimeSemanticEntitySection(
  record: Pick<RuntimeSemanticEntityRecord, "scope" | "project_ref">,
  projectRef: string,
): RuntimeProjectionTargetSection | undefined {
  if (record.scope === "project") {
    if (record.project_ref !== projectRef) {
      return undefined;
    }
    return "projectRuntime";
  }
  if (record.scope === "user" || record.scope === "universal") {
    return "globalRuntime";
  }
  return undefined;
}

interface ParsedPayloadScopeMetadata {
  scope?: ScopeKind;
  project_ref?: string;
}

function extractPayloadScopeMetadata(parsed: unknown): ParsedPayloadScopeMetadata {
  if (typeof parsed !== "object" || parsed === null) {
    return {};
  }

  const candidate = parsed as { scope?: unknown; project_ref?: unknown };
  const metadata: ParsedPayloadScopeMetadata = {};

  if (
    candidate.scope === "project" ||
    candidate.scope === "user" ||
    candidate.scope === "universal"
  ) {
    metadata.scope = candidate.scope;
  }

  if (typeof candidate.project_ref === "string" && candidate.project_ref.length > 0) {
    metadata.project_ref = candidate.project_ref;
  }

  return metadata;
}

function validateRecordPayloadAlignment(
  record: RuntimeSemanticEntityRecord,
  payload: ParsedPayloadScopeMetadata,
): RuntimeProjectionMaterializationSkip | undefined {
  if (payload.scope !== undefined && payload.scope !== record.scope) {
    return {
      recordId: record.id,
      kind: record.kind,
      reason: "record_payload_scope_mismatch",
      message: `Record scope ${record.scope} differs from payload scope ${payload.scope}`,
    };
  }

  if (
    payload.project_ref !== undefined &&
    payload.project_ref !== record.project_ref
  ) {
    return {
      recordId: record.id,
      kind: record.kind,
      reason: "record_payload_project_ref_mismatch",
      message: `Record project_ref ${record.project_ref ?? "(missing)"} differs from payload project_ref ${payload.project_ref}`,
    };
  }

  const effectiveScope = payload.scope ?? record.scope;
  if (effectiveScope === "project" && record.project_ref === undefined) {
    return {
      recordId: record.id,
      kind: record.kind,
      reason: "missing_record_project_ref",
      message: "Project-scoped entity requires record.project_ref",
    };
  }

  return undefined;
}

interface DecisionLeaningIndex {
  byDecisionId: Map<string, CurrentDecisionLeaning>;
  orphanLeanings: RuntimeProjectionMaterializationSkip[];
}

function indexDecisionLeanings(
  records: readonly RuntimeSemanticEntityRecord[],
): DecisionLeaningIndex {
  const byDecisionId = new Map<string, CurrentDecisionLeaning>();
  const orphanLeanings: RuntimeProjectionMaterializationSkip[] = [];

  for (const record of records) {
    if (record.kind !== "current-decision-leaning") {
      continue;
    }

    const parsed = parseRuntimeEntityAtBoundary("current-decision-leaning", record.payload);
    if (!parsed.success) {
      orphanLeanings.push({
        recordId: record.id,
        kind: record.kind,
        reason: "invalid_sub_entity",
        message: parsed.error,
      });
      continue;
    }

    byDecisionId.set(parsed.value.decision_id, parsed.value);
  }

  return { byDecisionId, orphanLeanings };
}

function resolveDecisionId(record: RuntimeSemanticEntityRecord): string | undefined {
  if (record.kind !== "unresolved-decision") {
    return undefined;
  }

  const parsed = parseRuntimeEntityAtBoundary("unresolved-decision", record.payload);
  if (!parsed.success) {
    return record.id;
  }

  return parsed.value.id;
}

function formatRecordForProjection(
  record: RuntimeSemanticEntityRecord,
  leaningByDecisionId: Map<string, CurrentDecisionLeaning>,
): ReturnType<typeof formatRuntimeEntityForProjection> {
  if (record.kind === "unresolved-decision") {
    const decisionId = resolveDecisionId(record);
    const currentLeaning =
      decisionId === undefined ? undefined : leaningByDecisionId.get(decisionId);

    return formatRuntimeEntityForProjection("unresolved-decision", record.payload, {
      currentLeaning,
    });
  }

  return formatRuntimeEntityForProjection(record.kind, record.payload);
}

function collectOrphanLeanings(
  records: readonly RuntimeSemanticEntityRecord[],
  leaningIndex: DecisionLeaningIndex,
): RuntimeProjectionMaterializationSkip[] {
  const parentDecisionIds = new Set<string>();
  for (const record of records) {
    if (record.kind !== "unresolved-decision") {
      continue;
    }
    const decisionId = resolveDecisionId(record);
    if (decisionId !== undefined) {
      parentDecisionIds.add(decisionId);
    }
  }

  const orphanSkips: RuntimeProjectionMaterializationSkip[] = [...leaningIndex.orphanLeanings];
  for (const record of records) {
    if (record.kind !== "current-decision-leaning") {
      continue;
    }

    const parsed = parseRuntimeEntityAtBoundary("current-decision-leaning", record.payload);
    if (!parsed.success) {
      continue;
    }

    if (!parentDecisionIds.has(parsed.value.decision_id)) {
      orphanSkips.push({
        recordId: record.id,
        kind: record.kind,
        reason: "orphan_sub_entity",
        message: `No parent unresolved-decision for decision_id ${parsed.value.decision_id}`,
      });
    }
  }

  return orphanSkips;
}

/** Materialize projection-ready runtime text blocks from a typed entity source. */
export function materializeRuntimeProjectionFromSource(
  source: RuntimeSemanticEntitySource,
  options: MaterializeRuntimeProjectionFromSourceOptions,
): MaterializeRuntimeProjectionFromSourceResult {
  const records = source.listEntities();
  const leaningIndex = indexDecisionLeanings(records);
  const orphanSkips = collectOrphanLeanings(records, leaningIndex);

  const items: RuntimeProjectionMaterializedItem[] = [];
  const skipped: RuntimeProjectionMaterializationSkip[] = [...orphanSkips];

  for (const record of records) {
    if (record.kind === "current-decision-leaning") {
      continue;
    }

    const parsed = parseRuntimeEntityAtBoundary(record.kind, record.payload);
    if (!parsed.success) {
      skipped.push({
        recordId: record.id,
        kind: record.kind,
        reason: "invalid_input",
        message: parsed.error,
      });
      continue;
    }

    const alignmentSkip = validateRecordPayloadAlignment(
      record,
      extractPayloadScopeMetadata(parsed.value),
    );
    if (alignmentSkip !== undefined) {
      skipped.push(alignmentSkip);
      continue;
    }

    const section = resolveRuntimeSemanticEntitySection(record, options.projectRef);
    if (section === undefined) {
      skipped.push({
        recordId: record.id,
        kind: record.kind,
        reason: "scope_mismatch",
        message: `Entity scope ${record.scope} does not match projectRef ${options.projectRef}`,
      });
      continue;
    }

    const formattedResult = formatRecordForProjection(record, leaningIndex.byDecisionId);
    if (!formattedResult.ok) {
      skipped.push({
        recordId: record.id,
        kind: record.kind,
        reason: formattedResult.reason,
        message: formattedResult.error,
      });
      continue;
    }

    if (formattedResult.formatted === null) {
      skipped.push({
        recordId: record.id,
        kind: record.kind,
        reason: "empty_format",
        message: `${record.kind} produced no projection output`,
      });
      continue;
    }

    if (!isProjectableFormatterKind(record.kind)) {
      skipped.push({
        recordId: record.id,
        kind: record.kind,
        reason: "not_projectable",
        message: `${record.kind} is not projectable`,
      });
      continue;
    }

    items.push({
      id: record.id,
      kind: record.kind,
      section,
      formatted: formattedResult.formatted,
      text: joinRuntimeProjectionLines(formattedResult.formatted.lines),
    });
  }

  return { items, skipped };
}
