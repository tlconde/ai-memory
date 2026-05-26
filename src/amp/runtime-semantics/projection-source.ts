/**
 * Typed runtime semantic entity source adapter (RUNTIME-06).
 *
 * Falsifiable claim: in-memory runtime entity records convert to projection-
 * ready formatted text via formatParsedRuntimeEntityForProjection without storage or
 * .amp/local/runtime.md wiring.
 *
 * Scope validation ownership:
 * - schema.ts (Zod): payload-internal scope/project_ref symmetry.
 * - projection-source (this module): record envelope ↔ parsed payload alignment
 *   and record envelope ↔ materialization projectRef section routing.
 * - formatter-registry: projectability/renderability and format-time policy.
 */

import type { ScopeKind } from "../core/frame-schema.js";
import {
  formatParsedRuntimeEntityForProjection,
  isProjectableFormatterKind,
  parseRuntimeEntityAtBoundary,
  type FormatRuntimeEntityProjectionFailureReason,
  type FormatterEntityByKind,
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
  | "sub_entity_envelope_mismatch"
  | "duplicate_parent_entity"
  | "duplicate_sub_entity"
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

interface PayloadScopeMetadata {
  scope?: ScopeKind;
  project_ref?: string;
}

interface ParsedRuntimeSemanticEntityRecord {
  record: RuntimeSemanticEntityRecord;
  parseResult:
    | { success: false; error: string }
    | { success: true; value: FormatterEntityByKind[FormatterRegistryKind] };
  payloadScope: PayloadScopeMetadata;
  envelopeSkip?: RuntimeProjectionMaterializationSkip;
  section?: RuntimeProjectionTargetSection;
}

interface LeaningAttachmentCandidate {
  recordId: string;
  leaning: CurrentDecisionLeaning;
}

interface LeaningAttachmentIndex {
  byDecisionId: Map<string, CurrentDecisionLeaning>;
  skipsByRecordId: Map<string, RuntimeProjectionMaterializationSkip>;
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

function extractPayloadScopeMetadata(
  kind: FormatterRegistryKind,
  parsed: FormatterEntityByKind[FormatterRegistryKind],
): PayloadScopeMetadata {
  switch (kind) {
    case "unresolved-decision": {
      const entity = parsed as FormatterEntityByKind["unresolved-decision"];
      return { scope: entity.scope };
    }
    case "runtime-preference-candidate": {
      const entity = parsed as FormatterEntityByKind["runtime-preference-candidate"];
      return {
        scope: entity.scope,
        project_ref: entity.project_ref,
      };
    }
    case "runtime-crystal-candidate": {
      const entity = parsed as FormatterEntityByKind["runtime-crystal-candidate"];
      return {
        scope: entity.scope,
        project_ref: entity.project_ref,
      };
    }
    case "rejected-signal-log": {
      const entity = parsed as FormatterEntityByKind["rejected-signal-log"];
      return { scope: entity.scope };
    }
    case "episodic-frame": {
      const entity = parsed as FormatterEntityByKind["episodic-frame"];
      return {
        scope: entity.scope,
        project_ref: entity.project_ref,
      };
    }
    case "harness-operational-state": {
      const entity = parsed as FormatterEntityByKind["harness-operational-state"];
      return { project_ref: entity.project_ref };
    }
    case "current-decision-leaning":
    case "dormant-snapshot":
      return {};
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unhandled formatter registry kind: ${String(_exhaustive)}`);
    }
  }
}

function validateRecordPayloadAlignment(
  record: RuntimeSemanticEntityRecord,
  payload: PayloadScopeMetadata,
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

function resolveEnvelopeSkip(
  record: RuntimeSemanticEntityRecord,
  payloadScope: PayloadScopeMetadata,
  projectRef: string,
): RuntimeProjectionMaterializationSkip | undefined {
  const alignmentSkip = validateRecordPayloadAlignment(record, payloadScope);
  if (alignmentSkip !== undefined) {
    return alignmentSkip;
  }

  if (resolveRuntimeSemanticEntitySection(record, projectRef) === undefined) {
    return {
      recordId: record.id,
      kind: record.kind,
      reason: "scope_mismatch",
      message: `Entity scope ${record.scope} does not match projectRef ${projectRef}`,
    };
  }

  return undefined;
}

function parseRuntimeSemanticEntityRecords(
  records: readonly RuntimeSemanticEntityRecord[],
  projectRef: string,
): ParsedRuntimeSemanticEntityRecord[] {
  return records.map((record) => {
    const parseResult = parseRuntimeEntityAtBoundary(record.kind, record.payload);
    if (!parseResult.success) {
      return {
        record,
        parseResult,
        payloadScope: {},
      };
    }

    const payloadScope = extractPayloadScopeMetadata(record.kind, parseResult.value);
    const envelopeSkip = resolveEnvelopeSkip(record, payloadScope, projectRef);
    const section =
      envelopeSkip === undefined
        ? resolveRuntimeSemanticEntitySection(record, projectRef)
        : undefined;

    return {
      record,
      parseResult,
      payloadScope,
      envelopeSkip,
      section,
    };
  });
}

function recordEnvelopesCompatible(
  parent: RuntimeSemanticEntityRecord,
  child: RuntimeSemanticEntityRecord,
): boolean {
  if (parent.scope !== child.scope) {
    return false;
  }

  if (parent.scope === "project") {
    return parent.project_ref === child.project_ref;
  }

  return true;
}

function buildLeaningAttachmentIndex(
  parsedRecords: readonly ParsedRuntimeSemanticEntityRecord[],
): LeaningAttachmentIndex {
  const parentCandidatesById = new Map<string, ParsedRuntimeSemanticEntityRecord[]>();
  const skipsByRecordId = new Map<string, RuntimeProjectionMaterializationSkip>();

  for (const parsed of parsedRecords) {
    if (parsed.record.kind !== "unresolved-decision") {
      continue;
    }
    if (!parsed.parseResult.success || parsed.envelopeSkip !== undefined) {
      continue;
    }

    const decision = parsed.parseResult.value as FormatterEntityByKind["unresolved-decision"];
    const candidates = parentCandidatesById.get(decision.id) ?? [];
    candidates.push(parsed);
    parentCandidatesById.set(decision.id, candidates);
  }

  const parentDecisionsById = new Map<string, ParsedRuntimeSemanticEntityRecord>();
  for (const [decisionId, candidates] of parentCandidatesById) {
    if (candidates.length > 1) {
      for (const candidate of candidates) {
        skipsByRecordId.set(candidate.record.id, {
          recordId: candidate.record.id,
          kind: candidate.record.kind,
          reason: "duplicate_parent_entity",
          message: `Multiple unresolved-decision records share payload id ${decisionId}`,
        });
      }
      continue;
    }

    parentDecisionsById.set(decisionId, candidates[0]!);
  }

  const compatibleCandidatesByDecisionId = new Map<string, LeaningAttachmentCandidate[]>();

  for (const parsed of parsedRecords) {
    if (parsed.record.kind !== "current-decision-leaning") {
      continue;
    }

    if (!parsed.parseResult.success) {
      skipsByRecordId.set(parsed.record.id, {
        recordId: parsed.record.id,
        kind: parsed.record.kind,
        reason: "invalid_sub_entity",
        message: parsed.parseResult.error,
      });
      continue;
    }

    const leaning = parsed.parseResult.value as FormatterEntityByKind["current-decision-leaning"];
    const parent = parentDecisionsById.get(leaning.decision_id);
    if (parent === undefined) {
      skipsByRecordId.set(parsed.record.id, {
        recordId: parsed.record.id,
        kind: parsed.record.kind,
        reason: "orphan_sub_entity",
        message: `No parent unresolved-decision for decision_id ${leaning.decision_id}`,
      });
      continue;
    }

    if (!recordEnvelopesCompatible(parent.record, parsed.record)) {
      skipsByRecordId.set(parsed.record.id, {
        recordId: parsed.record.id,
        kind: parsed.record.kind,
        reason: "sub_entity_envelope_mismatch",
        message: `Leaning envelope scope=${parsed.record.scope} project_ref=${parsed.record.project_ref ?? "(missing)"} is incompatible with parent decision envelope scope=${parent.record.scope} project_ref=${parent.record.project_ref ?? "(missing)"}`,
      });
      continue;
    }

    const candidates = compatibleCandidatesByDecisionId.get(leaning.decision_id) ?? [];
    candidates.push({ recordId: parsed.record.id, leaning });
    compatibleCandidatesByDecisionId.set(leaning.decision_id, candidates);
  }

  const byDecisionId = new Map<string, CurrentDecisionLeaning>();

  for (const [decisionId, candidates] of compatibleCandidatesByDecisionId) {
    if (candidates.length > 1) {
      for (const candidate of candidates) {
        skipsByRecordId.set(candidate.recordId, {
          recordId: candidate.recordId,
          kind: "current-decision-leaning",
          reason: "duplicate_sub_entity",
          message: `Multiple compatible current-decision-leaning records for decision_id ${decisionId}`,
        });
      }
      continue;
    }

    byDecisionId.set(decisionId, candidates[0]!.leaning);
  }

  return { byDecisionId, skipsByRecordId };
}

/** Materialize projection-ready runtime text blocks from a typed entity source. */
export function materializeRuntimeProjectionFromSource(
  source: RuntimeSemanticEntitySource,
  options: MaterializeRuntimeProjectionFromSourceOptions,
): MaterializeRuntimeProjectionFromSourceResult {
  const parsedRecords = parseRuntimeSemanticEntityRecords(
    source.listEntities(),
    options.projectRef,
  );
  const leaningIndex = buildLeaningAttachmentIndex(parsedRecords);

  const items: RuntimeProjectionMaterializedItem[] = [];
  const skipped: RuntimeProjectionMaterializationSkip[] = [];

  for (const parsed of parsedRecords) {
    const { record } = parsed;

    if (record.kind === "current-decision-leaning") {
      const leaningSkip = leaningIndex.skipsByRecordId.get(record.id);
      if (leaningSkip !== undefined) {
        skipped.push(leaningSkip);
      }
      continue;
    }

    if (!parsed.parseResult.success) {
      skipped.push({
        recordId: record.id,
        kind: record.kind,
        reason: "invalid_input",
        message: parsed.parseResult.error,
      });
      continue;
    }

    if (parsed.envelopeSkip !== undefined) {
      skipped.push(parsed.envelopeSkip);
      continue;
    }

    const attachmentSkip = leaningIndex.skipsByRecordId.get(record.id);
    if (attachmentSkip !== undefined) {
      skipped.push(attachmentSkip);
      continue;
    }

    const section = parsed.section;
    if (section === undefined) {
      skipped.push({
        recordId: record.id,
        kind: record.kind,
        reason: "scope_mismatch",
        message: `Entity scope ${record.scope} does not match projectRef ${options.projectRef}`,
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

    const parsedValue = parsed.parseResult.value;
    const formattedResult =
      record.kind === "unresolved-decision"
        ? formatParsedRuntimeEntityForProjection(
            "unresolved-decision",
            parsedValue as FormatterEntityByKind["unresolved-decision"],
            {
              currentLeaning: leaningIndex.byDecisionId.get(
                (parsedValue as FormatterEntityByKind["unresolved-decision"]).id,
              ),
            },
          )
        : formatParsedRuntimeEntityForProjection(
            record.kind,
            parsedValue as FormatterEntityByKind[typeof record.kind],
          );

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
