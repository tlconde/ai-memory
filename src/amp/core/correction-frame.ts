/**
 * Correction frame helpers for inference feedback (spec §6.2, §13.8).
 *
 * Falsifiable claim: episodic correction frames carry classifier name, previous
 * and corrected outputs, and a context fingerprint that round-trips validation.
 */

import { z } from "zod";

import type { Frame, ProvenanceBlock, ScopeBlock } from "./frame-schema.js";
import { createFrame, parseFrame } from "./frame-schema.js";

export const CORRECTION_FRAME_CONTENT_TYPE = "inference_correction" as const;

export const CorrectionFrameContentSchema = z
  .object({
    type: z.literal(CORRECTION_FRAME_CONTENT_TYPE),
    classifier: z.string().min(1),
    previous_output: z.unknown(),
    corrected_output: z.unknown(),
    context_fingerprint: z.string().min(1),
    correction_reason: z.string().optional(),
  })
  .strict();

export type CorrectionFrameContent = z.infer<typeof CorrectionFrameContentSchema>;

export interface CreateCorrectionFrameInput {
  id: string;
  correctionOfFrameId: string;
  classifier: string;
  previousOutput: unknown;
  correctedOutput: unknown;
  contextFingerprint: string;
  scope: ScopeBlock;
  source: ProvenanceBlock;
  createdAt: string;
  correctionReason?: string;
}

/** Build a validated episodic correction frame targeting a prior frame id. */
export function createCorrectionFrame(input: CreateCorrectionFrameInput): Frame {
  const content: CorrectionFrameContent = {
    type: CORRECTION_FRAME_CONTENT_TYPE,
    classifier: input.classifier,
    previous_output: input.previousOutput,
    corrected_output: input.correctedOutput,
    context_fingerprint: input.contextFingerprint,
    ...(input.correctionReason ? { correction_reason: input.correctionReason } : {}),
  };

  return createFrame({
    id: input.id,
    kind: "episodic",
    content,
    source: input.source,
    created_at: input.createdAt,
    scope: input.scope,
    curation_mode: "personal",
    correction_of: input.correctionOfFrameId,
  });
}

export function parseCorrectionFrameContent(content: unknown) {
  return CorrectionFrameContentSchema.safeParse(content);
}

/** Returns true when the frame is an episodic inference correction event. */
export function isCorrectionFrame(frame: Frame): boolean {
  if (frame.kind !== "episodic" || !frame.correction_of) return false;
  return parseCorrectionFrameContent(frame.content).success;
}

/** Parse correction payload from a frame; returns undefined when not a correction frame. */
export function readCorrectionFrameContent(frame: Frame): CorrectionFrameContent | undefined {
  if (frame.kind !== "episodic" || !frame.correction_of) return undefined;
  const parsed = parseCorrectionFrameContent(frame.content);
  return parsed.success ? parsed.data : undefined;
}

export function validateCorrectionFrame(input: unknown): boolean {
  const parsed = parseFrame(input);
  if (!parsed.success) return false;
  return isCorrectionFrame(parsed.frame);
}
