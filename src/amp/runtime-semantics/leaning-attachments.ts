/**
 * Parent decision and current-decision-leaning attachment index (RUNTIME-06-POLISH3).
 *
 * Falsifiable claim: compatible leanings attach to at most one parent decision by
 * payload id, with fail-closed duplicate parent/leaning audit skips.
 */

import type { ScopeKind } from "../core/frame-schema.js";
import type { FormatterEntityByKind, FormatterRegistryKind } from "./formatter-registry.js";
import type { CurrentDecisionLeaning } from "./schema.js";

export interface LeaningAttachmentEntityEnvelope {
  id: string;
  kind: FormatterRegistryKind;
  scope: ScopeKind;
  project_ref?: string;
}

export type LeaningAttachmentSkipReason =
  | "orphan_sub_entity"
  | "sub_entity_envelope_mismatch"
  | "duplicate_parent_entity"
  | "duplicate_sub_entity"
  | "invalid_sub_entity";

export interface LeaningAttachmentSkip {
  recordId: string;
  kind: FormatterRegistryKind;
  reason: LeaningAttachmentSkipReason;
  message: string;
}

export interface LeaningAttachmentParsedRecord {
  record: LeaningAttachmentEntityEnvelope;
  parseResult:
    | { success: false; error: string }
    | { success: true; value: FormatterEntityByKind[FormatterRegistryKind] };
  hasEnvelopeSkip: boolean;
}

export interface LeaningAttachmentIndex {
  byDecisionId: Map<string, CurrentDecisionLeaning>;
  skipsByRecordId: Map<string, LeaningAttachmentSkip>;
}

interface LeaningAttachmentCandidate {
  recordId: string;
  leaning: CurrentDecisionLeaning;
}

interface AttachmentSkipEntry {
  recordId: string;
  kind: FormatterRegistryKind;
}

function recordEnvelopesCompatible(
  parent: LeaningAttachmentEntityEnvelope,
  child: LeaningAttachmentEntityEnvelope,
): boolean {
  if (parent.scope !== child.scope) {
    return false;
  }

  if (parent.scope === "project") {
    return parent.project_ref === child.project_ref;
  }

  return true;
}

function resolveUniqueAttachmentCandidates<T>(
  groups: ReadonlyMap<string, readonly T[]>,
  toSkipEntry: (candidate: T) => AttachmentSkipEntry,
  reason: LeaningAttachmentSkipReason,
  messageForKey: (key: string) => string,
): { uniqueByKey: Map<string, T>; duplicateSkips: LeaningAttachmentSkip[] } {
  const uniqueByKey = new Map<string, T>();
  const duplicateSkips: LeaningAttachmentSkip[] = [];

  for (const [key, candidates] of groups) {
    if (candidates.length > 1) {
      for (const candidate of candidates) {
        const skipEntry = toSkipEntry(candidate);
        duplicateSkips.push({
          recordId: skipEntry.recordId,
          kind: skipEntry.kind,
          reason,
          message: messageForKey(key),
        });
      }
      continue;
    }

    uniqueByKey.set(key, candidates[0]!);
  }

  return { uniqueByKey, duplicateSkips };
}

/** Build parent/leaning attachment index with fail-closed duplicate handling. */
export function buildLeaningAttachmentIndex(
  parsedRecords: readonly LeaningAttachmentParsedRecord[],
): LeaningAttachmentIndex {
  const parentCandidatesById = new Map<string, LeaningAttachmentParsedRecord[]>();
  const skipsByRecordId = new Map<string, LeaningAttachmentSkip>();

  for (const parsed of parsedRecords) {
    if (parsed.record.kind !== "unresolved-decision") {
      continue;
    }
    if (!parsed.parseResult.success || parsed.hasEnvelopeSkip) {
      continue;
    }

    const decision = parsed.parseResult.value as FormatterEntityByKind["unresolved-decision"];
    const candidates = parentCandidatesById.get(decision.id) ?? [];
    candidates.push(parsed);
    parentCandidatesById.set(decision.id, candidates);
  }

  const {
    uniqueByKey: parentByDecisionId,
    duplicateSkips: duplicateParentSkips,
  } = resolveUniqueAttachmentCandidates(
    parentCandidatesById,
    (candidate) => ({
      recordId: candidate.record.id,
      kind: candidate.record.kind,
    }),
    "duplicate_parent_entity",
    (decisionId) => `Multiple unresolved-decision records share payload id ${decisionId}`,
  );

  for (const skip of duplicateParentSkips) {
    skipsByRecordId.set(skip.recordId, skip);
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
    const parent = parentByDecisionId.get(leaning.decision_id);
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

  const { duplicateSkips: duplicateLeaningSkips } = resolveUniqueAttachmentCandidates(
    compatibleCandidatesByDecisionId,
    (candidate) => ({
      recordId: candidate.recordId,
      kind: "current-decision-leaning" as const,
    }),
    "duplicate_sub_entity",
    (decisionId) =>
      `Multiple compatible current-decision-leaning records for decision_id ${decisionId}`,
  );

  for (const skip of duplicateLeaningSkips) {
    skipsByRecordId.set(skip.recordId, skip);
  }

  const byDecisionId = new Map<string, CurrentDecisionLeaning>();

  for (const [decisionId, candidates] of compatibleCandidatesByDecisionId) {
    if (candidates.length !== 1) {
      continue;
    }

    byDecisionId.set(decisionId, candidates[0]!.leaning);
  }

  return { byDecisionId, skipsByRecordId };
}
