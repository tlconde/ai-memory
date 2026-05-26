/**
 * Record envelope ↔ parsed payload alignment (RUNTIME-15).
 *
 * Shared invariants for storage validation and projection materialization.
 */

import type { ScopeKind } from "../core/frame-schema.js";
import type {
  FormatterEntityByKind,
  FormatterRegistryKind,
} from "./formatter-registry.js";
import type {
  RuntimeFormatterRegistryKind,
  RuntimeSemanticEntityRecord,
} from "./entity-record.js";

export interface PayloadScopeMetadata {
  scope?: ScopeKind;
  project_ref?: string;
}

export type RecordPayloadAlignmentSkipReason =
  | "missing_record_project_ref"
  | "record_payload_scope_mismatch"
  | "record_payload_project_ref_mismatch";

export interface RecordPayloadAlignmentSkip {
  recordId: string;
  kind: RuntimeFormatterRegistryKind;
  reason: RecordPayloadAlignmentSkipReason;
  message: string;
}

/** Extract scope/project_ref metadata from a parsed payload for envelope alignment. */
export function extractPayloadScopeMetadata(
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

/** Validate record envelope alignment against parsed payload scope metadata. */
export function validateRecordPayloadAlignment(
  record: RuntimeSemanticEntityRecord,
  payload: PayloadScopeMetadata,
): RecordPayloadAlignmentSkip | undefined {
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
