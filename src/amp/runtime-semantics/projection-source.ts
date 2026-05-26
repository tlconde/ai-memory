/**
 * Typed runtime semantic entity source adapter (RUNTIME-06).
 *
 * Falsifiable claim: runtime entity records from a {@link RuntimeSemanticEntitySource}
 * convert to projection-ready formatted text via formatParsedRuntimeEntityForProjection
 * without storage or .amp/local/runtime.md wiring.
 *
 * Scope validation ownership:
 * - schema.ts (Zod): payload-internal scope/project_ref symmetry.
 * - record-envelope-alignment: record envelope ↔ parsed payload alignment.
 * - projection-source (this module): materialization projectRef section routing.
 * - formatter-registry: projectability/renderability and format-time policy.
 * - leaning-attachments: parent decision ↔ current-decision-leaning join policy.
 */

import {
  formatParsedRuntimeEntityForProjection,
  isProjectableFormatterKind,
  parseRuntimeEntityAtBoundary,
  type FormatRuntimeEntityForProjectionResult,
  type FormatRuntimeEntityProjectionFailureReason,
  type FormatterEntityByKind,
  type FormatterRegistryKind,
  type ProjectableFormatterKind,
} from "./formatter-registry.js";
import {
  joinRuntimeProjectionLines,
  type RuntimeProjectionFormat,
} from "./format-projection.js";
import {
  buildLeaningAttachmentIndex,
  type LeaningAttachmentIndex,
  type LeaningAttachmentParsedRecord,
  type LeaningAttachmentSkip,
} from "./leaning-attachments.js";
import {
  type RuntimeFormatterRegistryKind,
  type RuntimeSemanticEntityRecord,
  type RuntimeSemanticEntitySource,
} from "./entity-record.js";
import {
  extractPayloadScopeMetadata,
  type PayloadScopeMetadata,
  validateRecordPayloadAlignment,
} from "./record-envelope-alignment.js";

export type { RuntimeFormatterRegistryKind, RuntimeSemanticEntityRecord, RuntimeSemanticEntitySource };

/** In-memory RuntimeSemanticEntitySource for tests and offline projection wiring. */
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
  | LeaningAttachmentSkip["reason"]
  | "scope_mismatch"
  | "record_payload_scope_mismatch"
  | "record_payload_project_ref_mismatch"
  | "missing_record_project_ref"
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

interface ParsedRuntimeSemanticEntityRecord {
  record: RuntimeSemanticEntityRecord;
  parseResult:
    | { success: false; error: string }
    | { success: true; value: FormatterEntityByKind[FormatterRegistryKind] };
  payloadScope: PayloadScopeMetadata;
  envelopeSkip?: RuntimeProjectionMaterializationSkip;
  section?: RuntimeProjectionTargetSection;
}

function materializationSkip(
  record: RuntimeSemanticEntityRecord,
  reason: RuntimeProjectionMaterializationSkipReason,
  message: string,
): RuntimeProjectionMaterializationSkip {
  return {
    recordId: record.id,
    kind: record.kind,
    reason,
    message,
  };
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

function resolveEnvelopeSkip(
  record: RuntimeSemanticEntityRecord,
  payloadScope: PayloadScopeMetadata,
  projectRef: string,
  section: RuntimeProjectionTargetSection | undefined,
): RuntimeProjectionMaterializationSkip | undefined {
  const alignmentSkip = validateRecordPayloadAlignment(record, payloadScope);
  if (alignmentSkip !== undefined) {
    return alignmentSkip;
  }

  if (section === undefined) {
    return materializationSkip(
      record,
      "scope_mismatch",
      `Entity scope ${record.scope} does not match projectRef ${projectRef}`,
    );
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
    const section = resolveRuntimeSemanticEntitySection(record, projectRef);
    const envelopeSkip = resolveEnvelopeSkip(record, payloadScope, projectRef, section);

    return {
      record,
      parseResult,
      payloadScope,
      envelopeSkip,
      section: envelopeSkip === undefined ? section : undefined,
    };
  });
}

function toLeaningAttachmentInput(
  parsed: ParsedRuntimeSemanticEntityRecord,
): LeaningAttachmentParsedRecord {
  return {
    record: parsed.record,
    parseResult: parsed.parseResult,
    hasEnvelopeSkip: parsed.envelopeSkip !== undefined,
  };
}

function formatRecordForProjection(
  kind: ProjectableFormatterKind,
  parsedValue: FormatterEntityByKind[ProjectableFormatterKind],
  leaningIndex: LeaningAttachmentIndex,
): FormatRuntimeEntityForProjectionResult {
  if (kind === "unresolved-decision") {
    const decision = parsedValue as FormatterEntityByKind["unresolved-decision"];
    return formatParsedRuntimeEntityForProjection("unresolved-decision", decision, {
      currentLeaning: leaningIndex.byDecisionId.get(decision.id),
    });
  }

  return formatParsedRuntimeEntityForProjection(
    kind,
    parsedValue as FormatterEntityByKind[typeof kind],
  );
}

type MaterializationOutcome =
  | { kind: "skip"; skip: RuntimeProjectionMaterializationSkip }
  | { kind: "item"; item: RuntimeProjectionMaterializedItem }
  | { kind: "handled" };

function resolveMaterializationOutcome(
  parsed: ParsedRuntimeSemanticEntityRecord,
  leaningIndex: LeaningAttachmentIndex,
  projectRef: string,
): MaterializationOutcome {
  const { record } = parsed;

  if (record.kind === "current-decision-leaning") {
    const leaningSkip = leaningIndex.skipsByRecordId.get(record.id);
    return leaningSkip === undefined
      ? { kind: "handled" }
      : { kind: "skip", skip: leaningSkip };
  }

  if (!parsed.parseResult.success) {
    return {
      kind: "skip",
      skip: materializationSkip(record, "invalid_input", parsed.parseResult.error),
    };
  }

  if (parsed.envelopeSkip !== undefined) {
    return { kind: "skip", skip: parsed.envelopeSkip };
  }

  const attachmentSkip = leaningIndex.skipsByRecordId.get(record.id);
  if (attachmentSkip !== undefined) {
    return { kind: "skip", skip: attachmentSkip };
  }

  const section = parsed.section;
  if (section === undefined) {
    return {
      kind: "skip",
      skip: materializationSkip(
        record,
        "scope_mismatch",
        `Entity scope ${record.scope} does not match projectRef ${projectRef}`,
      ),
    };
  }

  if (!isProjectableFormatterKind(record.kind)) {
    return {
      kind: "skip",
      skip: materializationSkip(
        record,
        "not_projectable",
        `${record.kind} is not projectable`,
      ),
    };
  }

  const formattedResult = formatRecordForProjection(
    record.kind,
    parsed.parseResult.value as FormatterEntityByKind[typeof record.kind],
    leaningIndex,
  );

  if (!formattedResult.ok) {
    return {
      kind: "skip",
      skip: materializationSkip(record, formattedResult.reason, formattedResult.error),
    };
  }

  if (formattedResult.formatted === null) {
    return {
      kind: "skip",
      skip: materializationSkip(
        record,
        "empty_format",
        `${record.kind} produced no projection output`,
      ),
    };
  }

  return {
    kind: "item",
    item: {
      id: record.id,
      kind: record.kind,
      section,
      formatted: formattedResult.formatted,
      text: joinRuntimeProjectionLines(formattedResult.formatted.lines),
    },
  };
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
  const leaningIndex = buildLeaningAttachmentIndex(
    parsedRecords.map(toLeaningAttachmentInput),
  );

  const items: RuntimeProjectionMaterializedItem[] = [];
  const skipped: RuntimeProjectionMaterializationSkip[] = [];

  for (const parsed of parsedRecords) {
    const outcome = resolveMaterializationOutcome(parsed, leaningIndex, options.projectRef);
    if (outcome.kind === "skip") {
      skipped.push(outcome.skip);
    } else if (outcome.kind === "item") {
      items.push(outcome.item);
    }
  }

  return { items, skipped };
}
