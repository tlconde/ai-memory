/**
 * Map optimization audit events to typed episodic-frame records.
 */

import type { RuntimeSemanticEntityRecord } from "../../runtime-semantics/entity-record.js";
import type { EpisodicFrame } from "../../runtime-semantics/schema.js";
import type { ProposedEdit, ValidationResult } from "./types.js";

export const SKILL_OPTIMIZED_CAPTURE_PATH = "skill_optimization_accept";
export const SKILL_OPTIMIZATION_REJECTED_CAPTURE_PATH = "skill_optimization_reject";

export interface SkillOptimizedAuditInput {
  recordId: string;
  skillName: string;
  versionBefore: string;
  versionAfter: string;
  validation: ValidationResult;
  proposed: ProposedEdit;
  cycle: number;
  projectRef?: string;
  occurredAt: string;
  recordedAt: string;
}

export interface SkillOptimizationRejectedAuditInput {
  recordId: string;
  skillName: string;
  validation: ValidationResult;
  proposed: ProposedEdit;
  cycle: number;
  projectRef?: string;
  occurredAt: string;
  recordedAt: string;
}

function baseAuditFrame(
  input: {
    recordId: string;
    event_type: "skill_optimized" | "skill_optimization_rejected";
    summary: string;
    details: Record<string, unknown>;
    projectRef?: string;
    occurredAt: string;
    recordedAt: string;
  }
): RuntimeSemanticEntityRecord {
  const projectRef = input.projectRef?.trim();
  const payload: EpisodicFrame = {
    id: input.recordId,
    event_type: input.event_type,
    summary: input.summary,
    details: input.details,
    tags: ["skill-optimization"],
    scope: projectRef ? "project" : "user",
    ...(projectRef ? { project_ref: projectRef } : {}),
    curation_mode: "personal",
    occurred_at: input.occurredAt,
    recorded_at: input.recordedAt,
    source_signals: [],
    related_entities: {},
    evidence_refs: [],
    provenance: {
      transform_id: "skill-optimization:loop",
    },
    confidence: "high",
    source: "tool_observed",
    sensitivity: "normal",
    visibility: projectRef ? "project_only" : "user_private",
    pinned: false,
    lifecycle_state: "active",
  };

  return {
    id: input.recordId,
    kind: "episodic-frame",
    scope: projectRef ? "project" : "user",
    ...(projectRef ? { project_ref: projectRef } : {}),
    observed_at: input.occurredAt,
    payload,
  };
}

/** Map accepted optimization to an episodic-frame audit record. */
export function mapSkillOptimizedToEntityRecord(
  input: SkillOptimizedAuditInput
): RuntimeSemanticEntityRecord {
  const scoreDelta = input.validation.scoreAfter - input.validation.scoreBefore;
  return baseAuditFrame({
    recordId: input.recordId,
    event_type: "skill_optimized",
    summary: `Skill "${input.skillName}" optimized (${input.versionBefore} -> ${input.versionAfter}).`,
    details: {
      skill_name: input.skillName,
      version_before: input.versionBefore,
      version_after: input.versionAfter,
      score_before: input.validation.scoreBefore,
      score_after: input.validation.scoreAfter,
      score_delta: scoreDelta,
      cycle: input.cycle,
      budget_used: input.proposed.budgetUsed,
      capture_path: SKILL_OPTIMIZED_CAPTURE_PATH,
    },
    projectRef: input.projectRef,
    occurredAt: input.occurredAt,
    recordedAt: input.recordedAt,
  });
}

/** Map rejected optimization proposal to an episodic-frame audit record. */
export function mapSkillOptimizationRejectedToEntityRecord(
  input: SkillOptimizationRejectedAuditInput
): RuntimeSemanticEntityRecord {
  return baseAuditFrame({
    recordId: input.recordId,
    event_type: "skill_optimization_rejected",
    summary: `Skill "${input.skillName}" optimization rejected at cycle ${input.cycle}.`,
    details: {
      skill_name: input.skillName,
      score_before: input.validation.scoreBefore,
      score_after: input.validation.scoreAfter,
      reject_reason: input.validation.reject_reason ?? input.validation.reasons.join("; "),
      reasons: input.validation.reasons,
      cycle: input.cycle,
      budget_used: input.proposed.budgetUsed,
      capture_path: SKILL_OPTIMIZATION_REJECTED_CAPTURE_PATH,
    },
    projectRef: input.projectRef,
    occurredAt: input.occurredAt,
    recordedAt: input.recordedAt,
  });
}

/** Read reject_reason from a persisted optimization rejection audit frame. */
export function readRejectReasonFromAuditFrame(frame: EpisodicFrame): string | undefined {
  if (frame.event_type !== "skill_optimization_rejected") {
    return undefined;
  }
  const reason = frame.details?.reject_reason;
  return typeof reason === "string" ? reason : undefined;
}
