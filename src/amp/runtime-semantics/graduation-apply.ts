/**
 * Runtime graduation apply orchestration (RUNTIME-GRAD-03).
 *
 * Falsifiable claim: a single explicit operator apply writes one semantic frame
 * from a graduate preference-candidate decision, then optionally promotes the
 * matching runtime row after durable knowledge write succeeds.
 */

import { parseFrame } from "../core/frame-schema.js";
import type { KnowledgeStore } from "../substrate/storage/knowledge-store.js";
import {
  planRuntimeGraduation,
  type RuntimeGraduationDecision,
  type RuntimeGraduationPlan,
} from "./graduation-planner.js";

export type ApplyRuntimeGraduationFailureReason =
  | "record_not_found"
  | "decision_not_graduate"
  | "wrong_runtime_kind"
  | "invalid_target_frame"
  | "duplicate_frame_id"
  | "knowledge_write_failed";

export interface ApplyRuntimeGraduationInput {
  recordId: string;
  plan: RuntimeGraduationPlan;
  knowledgeStore: KnowledgeStore;
  graduatedAt?: string;
  promoteRuntimeRow?: (
    recordId: string,
    graduatedAt: string,
  ) => { ok: true } | { ok: false; error: string };
}

export interface ApplyRuntimeGraduationSuccess {
  ok: true;
  recordId: string;
  appliedFrameId: string;
  decision: Extract<RuntimeGraduationDecision, { status: "graduate" }>;
  runtimeRowMutated: boolean;
  runtimePromotionError?: string;
}

export interface ApplyRuntimeGraduationFailure {
  ok: false;
  recordId: string;
  reason: ApplyRuntimeGraduationFailureReason;
  error: string;
  decision?: RuntimeGraduationDecision;
}

export type ApplyRuntimeGraduationResult =
  | ApplyRuntimeGraduationSuccess
  | ApplyRuntimeGraduationFailure;

function findDecisionForRecord(
  plan: RuntimeGraduationPlan,
  recordId: string,
): RuntimeGraduationDecision | undefined {
  return plan.decisions.find((decision) => decision.recordId === recordId);
}

/** Fail closed when a durable graduation frame already exists for `recordId`. */
export function findGraduationDuplicateFrameFailure(
  knowledgeStore: KnowledgeStore,
  recordId: string,
): ApplyRuntimeGraduationFailure | undefined {
  const frameId = `runtime-graduation:${recordId}`;
  if (knowledgeStore.read(frameId) !== undefined) {
    return {
      ok: false,
      recordId,
      reason: "duplicate_frame_id",
      error: `Durable frame "${frameId}" already exists; graduation apply will not overwrite existing knowledge.`,
    };
  }
  return undefined;
}

/** Apply one graduate preference-candidate decision to durable knowledge storage. */
export function applyRuntimeGraduationDecision(
  input: ApplyRuntimeGraduationInput,
): ApplyRuntimeGraduationResult {
  const { recordId, plan, knowledgeStore } = input;
  const decision = findDecisionForRecord(plan, recordId);

  if (decision === undefined) {
    return {
      ok: false,
      recordId,
      reason: "record_not_found",
      error: `Runtime semantic entity "${recordId}" was not found in the graduation plan.`,
    };
  }

  if (decision.status !== "graduate") {
    return {
      ok: false,
      recordId,
      reason: "decision_not_graduate",
      error: `Graduation decision for "${recordId}" is ${decision.status}, not graduate.`,
      decision,
    };
  }

  if (decision.runtimeKind !== "runtime-preference-candidate") {
    return {
      ok: false,
      recordId,
      reason: "wrong_runtime_kind",
      error: `Graduation apply supports runtime-preference-candidate only; got ${decision.runtimeKind}.`,
      decision,
    };
  }

  if (decision.targetFrame.kind !== "semantic") {
    return {
      ok: false,
      recordId,
      reason: "invalid_target_frame",
      error: `Graduation target frame for "${recordId}" must be semantic; got ${decision.targetFrame.kind}.`,
      decision,
    };
  }

  const parsedFrame = parseFrame(decision.targetFrame);
  if (!parsedFrame.success) {
    return {
      ok: false,
      recordId,
      reason: "invalid_target_frame",
      error: parsedFrame.error,
      decision,
    };
  }

  const frameId = parsedFrame.frame.id;
  if (knowledgeStore.read(frameId) !== undefined) {
    return {
      ok: false,
      recordId,
      reason: "duplicate_frame_id",
      error: `Durable frame "${frameId}" already exists; graduation apply will not overwrite existing knowledge.`,
      decision,
    };
  }

  try {
    knowledgeStore.write([parsedFrame.frame]);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      recordId,
      reason: "knowledge_write_failed",
      error: message,
      decision,
    };
  }

  let runtimeRowMutated = false;
  let runtimePromotionError: string | undefined;

  if (input.promoteRuntimeRow) {
    const graduatedAt = input.graduatedAt ?? new Date().toISOString();
    const promotion = input.promoteRuntimeRow(recordId, graduatedAt);
    if (promotion.ok) {
      runtimeRowMutated = true;
    } else {
      runtimePromotionError = promotion.error;
    }
  }

  return {
    ok: true,
    recordId,
    appliedFrameId: frameId,
    decision,
    runtimeRowMutated,
    ...(runtimePromotionError ? { runtimePromotionError } : {}),
  };
}
