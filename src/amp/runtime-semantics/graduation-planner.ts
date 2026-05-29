/**
 * Pure runtime graduation planner (RUNTIME-GRAD-01).
 *
 * Falsifiable claim: typed runtime semantic records classify into auditable graduation
 * decisions without KnowledgeStore writes, RuntimeStore mutation, or consolidation wiring.
 */

import { createFrame, type Frame, type ScopeBlock } from "../core/frame-schema.js";
import type { RuntimeFormatterRegistryKind, RuntimeSemanticEntityRecord } from "./entity-record.js";
import {
  parseRuntimeEntityAtBoundary,
  type FormatterEntityByKind,
  type FormatterRegistryKind,
} from "./formatter-registry.js";
import {
  extractPayloadScopeMetadata,
  validateRecordPayloadAlignment,
} from "./record-envelope-alignment.js";
import { resolveRuntimeSemanticEntitySection } from "./projection-source.js";
import type {
  RuntimeConfidence,
  RuntimeCrystalCandidate,
  RuntimePreferenceCandidate,
  UnresolvedDecision,
} from "./schema.js";

export const RUNTIME_GRADUATION_SOURCE_SURFACE = "amp-runtime-graduation";

export const RUNTIME_GRADUATION_KIND_PROVENANCE = {
  preferenceCandidate: "runtime-graduation:preference-candidate",
  crystalCandidate: "runtime-graduation:crystal-candidate",
  resolvedDecision: "runtime-graduation:resolved-decision",
} as const;

export type RuntimeGraduationReason =
  | "explicit_confirmation"
  | "repetition_threshold_met"
  | "resolved_decision";

export type RuntimeGraduationDeferralReason =
  | "below_promotion_threshold"
  | "expired_preference"
  | "open_decision"
  | "active_hypothesis"
  | "supported_hypothesis_not_ready"
  | "stale_hypothesis"
  | "active_harness_state"
  | "episodic_mapper_not_implemented";

export type RuntimeGraduationSkipReason =
  | "invalid_input"
  | "scope_mismatch"
  | "record_payload_scope_mismatch"
  | "record_payload_project_ref_mismatch"
  | "missing_record_project_ref"
  | "audit_only"
  | "retrieval_beacon_only"
  | "sub_entity_only"
  | "already_promoted"
  | "already_graduated"
  | "abandoned"
  | "refuted_hypothesis";

export type RuntimeGraduationProposalReason =
  | "contradicted_preference"
  | "crystal_promotion_ready"
  | "orphaned_decision_option";

export interface RuntimeGraduationProposal {
  proposalKind: "contradicted_preference" | "crystal_promotion" | "orphaned_decision_option";
  summary: string;
}

export type RuntimeGraduationDecision =
  | {
      status: "graduate";
      recordId: string;
      runtimeKind: RuntimeFormatterRegistryKind;
      targetFrame: Frame;
      reason: RuntimeGraduationReason;
    }
  | {
      status: "defer";
      recordId: string;
      runtimeKind: RuntimeFormatterRegistryKind;
      reason: RuntimeGraduationDeferralReason;
      message: string;
    }
  | {
      status: "proposal_required";
      recordId: string;
      runtimeKind: RuntimeFormatterRegistryKind;
      reason: RuntimeGraduationProposalReason;
      proposal: RuntimeGraduationProposal;
    }
  | {
      status: "skip";
      recordId: string;
      runtimeKind: RuntimeFormatterRegistryKind;
      reason: RuntimeGraduationSkipReason;
      message: string;
    };

export interface RuntimeGraduationPlanSummary {
  graduate: number;
  defer: number;
  proposal_required: number;
  skip: number;
}

export interface RuntimeGraduationPlan {
  generatedAt: string;
  decisions: readonly RuntimeGraduationDecision[];
  summary: RuntimeGraduationPlanSummary;
}

export interface PlanRuntimeGraduationInput {
  records: readonly RuntimeSemanticEntityRecord[];
  generatedAt: string;
  projectRef?: string;
}

function hasNonBlank(values: readonly string[]): boolean {
  return values.some((value) => value.trim().length > 0);
}

function isNonBlankString(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function crystalHasLineage(crystal: RuntimeCrystalCandidate): boolean {
  return (
    hasNonBlank(crystal.source_signal_ids) ||
    isNonBlankString(crystal.lineage.transform_id)
  );
}

function isCrystalPromotionReady(crystal: RuntimeCrystalCandidate): boolean {
  return (
    crystal.contradiction_score === "low" &&
    crystal.successful_predictions.length >= 1 &&
    crystalHasLineage(crystal)
  );
}

function mapRuntimeConfidence(confidence: RuntimeConfidence): number {
  switch (confidence) {
    case "low":
      return 0.33;
    case "medium":
      return 0.66;
    case "high":
      return 0.9;
    default: {
      const _exhaustive: never = confidence;
      void _exhaustive;
      return 0.66;
    }
  }
}

function scopeBlockFromRecord(record: RuntimeSemanticEntityRecord): ScopeBlock {
  if (record.scope === "project") {
    return { kind: "project", project_ref: record.project_ref! };
  }
  return { kind: record.scope };
}

function graduationFrameId(recordId: string): string {
  return `runtime-graduation:${recordId}`;
}

function buildGraduationSource(capturedAt: string) {
  return {
    surface: RUNTIME_GRADUATION_SOURCE_SURFACE,
    captured_at: capturedAt,
  };
}

function skipDecision(
  record: RuntimeSemanticEntityRecord,
  reason: RuntimeGraduationSkipReason,
  message: string,
): RuntimeGraduationDecision {
  return {
    status: "skip",
    recordId: record.id,
    runtimeKind: record.kind,
    reason,
    message,
  };
}

function deferDecision(
  record: RuntimeSemanticEntityRecord,
  reason: RuntimeGraduationDeferralReason,
  message: string,
): RuntimeGraduationDecision {
  return {
    status: "defer",
    recordId: record.id,
    runtimeKind: record.kind,
    reason,
    message,
  };
}

function proposalDecision(
  record: RuntimeSemanticEntityRecord,
  reason: RuntimeGraduationProposalReason,
  proposal: RuntimeGraduationProposal,
): RuntimeGraduationDecision {
  return {
    status: "proposal_required",
    recordId: record.id,
    runtimeKind: record.kind,
    reason,
    proposal,
  };
}

function graduateDecision(
  record: RuntimeSemanticEntityRecord,
  targetFrame: Frame,
  reason: RuntimeGraduationReason,
): RuntimeGraduationDecision {
  return {
    status: "graduate",
    recordId: record.id,
    runtimeKind: record.kind,
    targetFrame,
    reason,
  };
}

function summarizeDecisions(
  decisions: readonly RuntimeGraduationDecision[],
): RuntimeGraduationPlanSummary {
  return decisions.reduce<RuntimeGraduationPlanSummary>(
    (counts, decision) => {
      counts[decision.status] += 1;
      return counts;
    },
    { graduate: 0, defer: 0, proposal_required: 0, skip: 0 },
  );
}

function resolvePreflightSkip(
  record: RuntimeSemanticEntityRecord,
  parsed: FormatterEntityByKind[FormatterRegistryKind],
  projectRef?: string,
): RuntimeGraduationDecision | undefined {
  const payloadScope = extractPayloadScopeMetadata(record.kind, parsed);
  const alignmentSkip = validateRecordPayloadAlignment(record, payloadScope);
  if (alignmentSkip !== undefined) {
    return skipDecision(record, alignmentSkip.reason, alignmentSkip.message);
  }

  if (projectRef !== undefined) {
    const section = resolveRuntimeSemanticEntitySection(record, projectRef);
    if (section === undefined) {
      return skipDecision(
        record,
        "scope_mismatch",
        `Entity scope ${record.scope} does not match projectRef ${projectRef}`,
      );
    }
  }

  return undefined;
}

function buildPreferenceGraduationFrame(
  record: RuntimeSemanticEntityRecord,
  preference: RuntimePreferenceCandidate,
  explicitConfirmation: boolean,
): Frame {
  return createFrame({
    id: graduationFrameId(record.id),
    kind: "semantic",
    content: {
      type: "preference",
      statement: preference.statement,
      mode: preference.mode,
      context: preference.context,
      source_runtime_entity_id: record.id,
    },
    source: buildGraduationSource(preference.last_observed_at),
    created_at: preference.last_observed_at,
    scope: scopeBlockFromRecord(record),
    curation_mode: "personal",
    ...(preference.mode === "time_bounded" && preference.expires_at
      ? { valid_until: preference.expires_at }
      : {}),
    confidence: mapRuntimeConfidence(preference.confidence),
    confidence_basis: explicitConfirmation
      ? { type: "direct_statement" }
      : {
          type: "experience_confidence",
          iterations: preference.promotion_evidence.repetition_count,
          notes: `${preference.promotion_evidence.independent_sessions} independent sessions`,
        },
    kind_provenance: {
      default_inferred: "semantic",
      default_basis: RUNTIME_GRADUATION_KIND_PROVENANCE.preferenceCandidate,
      user_override: null,
      override_reason: null,
      final_kind_source: "default",
    },
  });
}

function planPreferenceCandidate(
  record: RuntimeSemanticEntityRecord,
  preference: RuntimePreferenceCandidate,
): RuntimeGraduationDecision {
  switch (preference.status) {
    case "promoted":
      return skipDecision(
        record,
        "already_promoted",
        "RuntimePreferenceCandidate is already promoted.",
      );
    case "abandoned":
      return skipDecision(
        record,
        "abandoned",
        "RuntimePreferenceCandidate was abandoned.",
      );
    case "contradicted":
      return proposalDecision(
        record,
        "contradicted_preference",
        {
          proposalKind: "contradicted_preference",
          summary: preference.statement,
        },
      );
    case "expired":
      return deferDecision(
        record,
        "expired_preference",
        "Expired preference candidates defer until operator review.",
      );
    case "active": {
      const evidence = preference.promotion_evidence;
      if (evidence.explicit_confirmation_signal_id?.trim()) {
        return graduateDecision(
          record,
          buildPreferenceGraduationFrame(record, preference, true),
          "explicit_confirmation",
        );
      }

      if (
        evidence.repetition_count >= 3 &&
        evidence.independent_sessions >= 2
      ) {
        return graduateDecision(
          record,
          buildPreferenceGraduationFrame(record, preference, false),
          "repetition_threshold_met",
        );
      }

      return deferDecision(
        record,
        "below_promotion_threshold",
        "Active preference candidate has not met graduation thresholds.",
      );
    }
    default: {
      const _exhaustive: never = preference.status;
      void _exhaustive;
      return deferDecision(record, "below_promotion_threshold", "Unhandled preference status.");
    }
  }
}

function buildResolvedDecisionFrame(
  record: RuntimeSemanticEntityRecord,
  decision: UnresolvedDecision,
  selectedOption: UnresolvedDecision["options"][number],
): Frame {
  const ownerIsUser = decision.owner === "user";
  return createFrame({
    id: graduationFrameId(record.id),
    kind: "semantic",
    content: {
      type: "decision",
      question: decision.question,
      selected_option: selectedOption,
      options: decision.options,
      urgency: decision.urgency,
      owner: decision.owner,
      ...(decision.decision_due ? { decision_due: decision.decision_due } : {}),
      source_runtime_entity_id: record.id,
    },
    source: buildGraduationSource(decision.last_touched_at),
    created_at: decision.last_touched_at,
    scope: scopeBlockFromRecord(record),
    curation_mode: "personal",
    confidence_basis: ownerIsUser
      ? { type: "direct_statement" }
      : { type: "source_attestation" },
    kind_provenance: {
      default_inferred: "semantic",
      default_basis: RUNTIME_GRADUATION_KIND_PROVENANCE.resolvedDecision,
      user_override: null,
      override_reason: null,
      final_kind_source: "default",
    },
  });
}

function planUnresolvedDecision(
  record: RuntimeSemanticEntityRecord,
  decision: UnresolvedDecision,
): RuntimeGraduationDecision {
  switch (decision.status) {
    case "abandoned":
      return skipDecision(
        record,
        "abandoned",
        "UnresolvedDecision was abandoned.",
      );
    case "open":
      return deferDecision(
        record,
        "open_decision",
        "Open decisions remain runtime state until resolved.",
      );
    case "decided": {
      const selectedOptionId = decision.selected_option_id?.trim();
      if (!selectedOptionId) {
        return proposalDecision(
          record,
          "orphaned_decision_option",
          {
            proposalKind: "orphaned_decision_option",
            summary: decision.question,
          },
        );
      }

      const selectedOption = decision.options.find((option) => option.id === selectedOptionId);
      if (selectedOption === undefined) {
        return proposalDecision(
          record,
          "orphaned_decision_option",
          {
            proposalKind: "orphaned_decision_option",
            summary: decision.question,
          },
        );
      }

      if (!hasNonBlank(decision.provenance)) {
        return deferDecision(
          record,
          "open_decision",
          "Decided UnresolvedDecision requires non-blank provenance before graduation.",
        );
      }

      return graduateDecision(
        record,
        buildResolvedDecisionFrame(record, decision, selectedOption),
        "resolved_decision",
      );
    }
    default: {
      const _exhaustive: never = decision.status;
      void _exhaustive;
      return deferDecision(record, "open_decision", "Unhandled decision status.");
    }
  }
}

function planRuntimeCrystalCandidate(
  record: RuntimeSemanticEntityRecord,
  crystal: RuntimeCrystalCandidate,
): RuntimeGraduationDecision {
  switch (crystal.status) {
    case "promoted":
      return skipDecision(
        record,
        "already_promoted",
        "RuntimeCrystalCandidate is already promoted.",
      );
    case "abandoned":
      return skipDecision(
        record,
        "abandoned",
        "RuntimeCrystalCandidate was abandoned.",
      );
    case "refuted":
      return skipDecision(
        record,
        "refuted_hypothesis",
        "Refuted hypotheses do not graduate to durable knowledge.",
      );
    case "stale":
      return deferDecision(
        record,
        "stale_hypothesis",
        "Stale hypotheses defer until refreshed or abandoned.",
      );
    case "active":
      return deferDecision(
        record,
        "active_hypothesis",
        "Active hypotheses remain provisional runtime state.",
      );
    case "supported": {
      if (isCrystalPromotionReady(crystal)) {
        return proposalDecision(
          record,
          "crystal_promotion_ready",
          {
            proposalKind: "crystal_promotion",
            summary: crystal.claim,
          },
        );
      }

      return deferDecision(
        record,
        "supported_hypothesis_not_ready",
        "Supported crystal candidate lacks promotion-ready evidence.",
      );
    }
    default: {
      const _exhaustive: never = crystal.status;
      void _exhaustive;
      return deferDecision(record, "active_hypothesis", "Unhandled crystal status.");
    }
  }
}

function planRecordDecision(
  record: RuntimeSemanticEntityRecord,
  parsed: FormatterEntityByKind[FormatterRegistryKind],
): RuntimeGraduationDecision {
  switch (record.kind) {
    case "runtime-preference-candidate":
      return planPreferenceCandidate(
        record,
        parsed as FormatterEntityByKind["runtime-preference-candidate"],
      );
    case "unresolved-decision":
      return planUnresolvedDecision(
        record,
        parsed as FormatterEntityByKind["unresolved-decision"],
      );
    case "runtime-crystal-candidate":
      return planRuntimeCrystalCandidate(
        record,
        parsed as FormatterEntityByKind["runtime-crystal-candidate"],
      );
    case "rejected-signal-log":
      return skipDecision(
        record,
        "audit_only",
        "RejectedSignalLog is retained as runtime audit metadata and never graduates to durable knowledge.",
      );
    case "dormant-snapshot":
      return skipDecision(
        record,
        "retrieval_beacon_only",
        "DormantSnapshot is a retrieval beacon and never graduates to durable knowledge.",
      );
    case "current-decision-leaning":
      return skipDecision(
        record,
        "sub_entity_only",
        "CurrentDecisionLeaning is a transient sub-entity and never graduates standalone.",
      );
    case "harness-operational-state": {
      const harness = parsed as FormatterEntityByKind["harness-operational-state"];
      if (harness.status === "closed") {
        return deferDecision(
          record,
          "episodic_mapper_not_implemented",
          "Closed harness operational state requires episodic mapper wiring before graduation.",
        );
      }
      return deferDecision(
        record,
        "active_harness_state",
        "Active harness operational state remains runtime-only.",
      );
    }
    case "episodic-frame":
      return deferDecision(
        record,
        "episodic_mapper_not_implemented",
        "Runtime EpisodicFrame graduation requires a dedicated episodic mapper.",
      );
    default: {
      const _exhaustive: never = record.kind;
      void _exhaustive;
      return skipDecision(record, "invalid_input", `Unsupported runtime kind: ${record.kind}`);
    }
  }
}

/** Build a pure graduation plan for typed runtime semantic entity records. */
export function planRuntimeGraduation(input: PlanRuntimeGraduationInput): RuntimeGraduationPlan {
  const decisions: RuntimeGraduationDecision[] = [];

  for (const record of input.records) {
    if (record.graduation_status === "graduated" || record.graduated_at !== undefined) {
      decisions.push(
        skipDecision(
          record,
          "already_graduated",
          "Runtime semantic entity was already graduated to durable knowledge.",
        ),
      );
      continue;
    }

    const parsed = parseRuntimeEntityAtBoundary(record.kind, record.payload);
    if (!parsed.success) {
      decisions.push(
        skipDecision(record, "invalid_input", parsed.error),
      );
      continue;
    }

    const preflightSkip = resolvePreflightSkip(record, parsed.value, input.projectRef);
    if (preflightSkip !== undefined) {
      decisions.push(preflightSkip);
      continue;
    }

    decisions.push(planRecordDecision(record, parsed.value));
  }

  return {
    generatedAt: input.generatedAt,
    decisions,
    summary: summarizeDecisions(decisions),
  };
}
