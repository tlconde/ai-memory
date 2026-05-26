/**
 * Production-facing runtime semantic provenance gates (RUNTIME-28).
 *
 * Falsifiable claim: facade writes for schemas with provenance fields fail closed
 * when the payload cannot be traced back to a transform or source signal.
 */

import { parseRuntimeEntityAtBoundary } from "./formatter-registry.js";
import type {
  FormatterEntityByKind,
  FormatterRegistryKind,
} from "./formatter-registry.js";
import type { RuntimeSemanticEntityRecord } from "./entity-record.js";

export type RuntimeSemanticEntityProvenanceFailureReason =
  | "missing_provenance_transform_id"
  | "missing_source_signal_id"
  | "missing_source_signal_ids"
  | "missing_provenance_refs";

export type RuntimeSemanticEntityProvenanceValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: RuntimeSemanticEntityProvenanceFailureReason;
      message: string;
    };

function missing(
  reason: RuntimeSemanticEntityProvenanceFailureReason,
  kind: string,
): RuntimeSemanticEntityProvenanceValidationResult {
  return {
    ok: false,
    reason,
    message: `${kind} requires traceable provenance for facade writes`,
  };
}

function requireProvenance(
  condition: boolean,
  reason: RuntimeSemanticEntityProvenanceFailureReason,
  kind: string,
): RuntimeSemanticEntityProvenanceValidationResult {
  return condition ? { ok: true } : missing(reason, kind);
}

function isNonBlank(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function hasNonBlank(values: readonly string[]): boolean {
  return values.some(isNonBlank);
}

function validateParsedProvenance<K extends FormatterRegistryKind>(
  kind: K,
  payload: unknown,
  validate: (
    entity: FormatterEntityByKind[K],
  ) => RuntimeSemanticEntityProvenanceValidationResult,
): RuntimeSemanticEntityProvenanceValidationResult {
  const parsed = parseRuntimeEntityAtBoundary(kind, payload);
  if (!parsed.success) {
    return { ok: true };
  }
  return validate(parsed.value);
}

/** Validate provenance required by production-facing capture/consolidation writes. */
export function validateRuntimeSemanticEntityWriteProvenance(
  record: RuntimeSemanticEntityRecord,
): RuntimeSemanticEntityProvenanceValidationResult {
  switch (record.kind) {
    case "unresolved-decision":
      return validateParsedProvenance(record.kind, record.payload, (entity) =>
        requireProvenance(
          hasNonBlank(entity.provenance),
          "missing_provenance_refs",
          record.kind,
        )
      );

    case "current-decision-leaning":
      return validateParsedProvenance(record.kind, record.payload, (entity) =>
        requireProvenance(
          isNonBlank(entity.source_signal_id),
          "missing_source_signal_id",
          record.kind,
        )
      );

    case "runtime-preference-candidate":
      return validateParsedProvenance(record.kind, record.payload, (entity) =>
        requireProvenance(
          hasNonBlank(entity.source_signal_ids),
          "missing_source_signal_ids",
          record.kind,
        )
      );

    case "runtime-crystal-candidate":
      return validateParsedProvenance(record.kind, record.payload, (entity) =>
        requireProvenance(
          hasNonBlank(entity.source_signal_ids) || isNonBlank(entity.lineage.transform_id),
          "missing_source_signal_ids",
          record.kind,
        )
      );

    case "harness-operational-state":
      return validateParsedProvenance(record.kind, record.payload, (entity) =>
        requireProvenance(
          hasNonBlank(entity.source_signal_ids),
          "missing_source_signal_ids",
          record.kind,
        )
      );

    case "rejected-signal-log": {
      return { ok: true };
    }

    case "episodic-frame":
      return validateParsedProvenance(record.kind, record.payload, (entity) =>
        requireProvenance(
          isNonBlank(entity.provenance.transform_id),
          "missing_provenance_transform_id",
          record.kind,
        )
      );

    case "dormant-snapshot": {
      return { ok: true };
    }

    default: {
      const _exhaustive: never = record.kind;
      void _exhaustive;
      return { ok: true };
    }
  }
}
