/**
 * Shared curation_mode guardrails (spec §12.5).
 *
 * Falsifiable claim: frames never enter or leave `shared` without an explicit
 * user confirmation frame; no automatic promotion or demotion.
 */

import { z } from "zod";

import type { CurationMode, Frame } from "./frame-schema.js";
import { createFrame, CurationModeSchema, parseFrame } from "./frame-schema.js";

export const CURATION_MODE_CONFIRMATION_KIND = "curation_mode_change_confirmation" as const;

export const CurationModeConfirmationContentSchema = z
  .object({
    type: z.literal(CURATION_MODE_CONFIRMATION_KIND),
    frame_id: z.string().min(1),
    from_mode: CurationModeSchema,
    to_mode: CurationModeSchema,
    reason: z.string(),
    confirmed_by: z.string(),
  })
  .strict();

export type CurationModeConfirmationContent = z.infer<typeof CurationModeConfirmationContentSchema>;

export interface CurationModeChangeRequest {
  frameId: string;
  fromMode: CurationMode;
  toMode: CurationMode;
  reason: string;
  confirmedAt: string;
  confirmedBy: string;
  scope?: Frame["scope"];
}

export class CurationModeGuardrailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CurationModeGuardrailError";
  }
}

/** True when the transition touches `shared` and changes curation mode. */
export function requiresSharedCurationConfirmation(from: CurationMode, to: CurationMode): boolean {
  if (from === to) return false;
  return from === "shared" || to === "shared";
}

export function isCurationConfirmationFor(
  confirmation: Frame,
  frameId: string,
  targetMode: CurationMode
): boolean {
  if (confirmation.kind !== "episodic") return false;
  const parsed = CurationModeConfirmationContentSchema.safeParse(confirmation.content);
  if (!parsed.success) return false;
  return parsed.data.frame_id === frameId && parsed.data.to_mode === targetMode;
}

export function canChangeCurationMode(
  frame: Frame,
  targetMode: CurationMode,
  confirmation?: Frame
): boolean {
  if (frame.curation_mode === targetMode) return true;
  if (!requiresSharedCurationConfirmation(frame.curation_mode, targetMode)) return true;
  return confirmation !== undefined && isCurationConfirmationFor(confirmation, frame.id, targetMode);
}

export function applyCurationModeChange(
  frame: Frame,
  targetMode: CurationMode,
  confirmation?: Frame
): Frame {
  if (!canChangeCurationMode(frame, targetMode, confirmation)) {
    throw new CurationModeGuardrailError(
      `Cannot change frame ${frame.id} curation_mode from ${frame.curation_mode} to ${targetMode} without explicit confirmation`
    );
  }

  if (frame.curation_mode === targetMode) return frame;

  return createFrame({
    ...frame,
    curation_mode: targetMode,
  });
}

/** Promote a frame to `shared`; requires explicit user confirmation. */
export function promoteToShared(frame: Frame, confirmation: Frame): Frame {
  if (frame.curation_mode === "shared") return frame;
  return applyCurationModeChange(frame, "shared", confirmation);
}

/** Demote a frame from `shared`; requires explicit user confirmation. */
export function demoteFromShared(frame: Frame, targetMode: CurationMode, confirmation: Frame): Frame {
  if (frame.curation_mode !== "shared") {
    throw new CurationModeGuardrailError(
      `Frame ${frame.id} is not shared; current curation_mode is ${frame.curation_mode}`
    );
  }
  if (targetMode === "shared") return frame;
  return applyCurationModeChange(frame, targetMode, confirmation);
}

export function createCurationModeConfirmationFrame(request: CurationModeChangeRequest): Frame {
  return createFrame({
    id: `curation-confirm-${request.frameId}-${request.toMode}`,
    kind: "episodic",
    content: {
      type: CURATION_MODE_CONFIRMATION_KIND,
      frame_id: request.frameId,
      from_mode: request.fromMode,
      to_mode: request.toMode,
      reason: request.reason,
      confirmed_by: request.confirmedBy,
    },
    source: { surface: "amp", harness: "substrate" },
    created_at: request.confirmedAt,
    scope: request.scope ?? { kind: "user" },
    curation_mode: "personal",
  });
}

export function validateCurationModeConfirmationFrame(input: unknown): boolean {
  const parsed = parseFrame(input);
  if (!parsed.success) return false;
  return (
    parsed.frame.kind === "episodic" &&
    CurationModeConfirmationContentSchema.safeParse(parsed.frame.content).success
  );
}
