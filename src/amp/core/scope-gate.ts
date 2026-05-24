/**
 * Scope promotion gate — Invariant 1: scope is never inferred upward.
 *
 * Falsifiable claim: project-scoped frames cannot become user-scoped without
 * an explicit confirmation frame recorded in the knowledge store.
 */

import { z } from "zod";

import type { Frame } from "./frame-schema.js";
import { createFrame, parseFrame, ScopeKindSchema } from "./frame-schema.js";

export const SCOPE_CONFIRMATION_KIND = "scope_promotion_confirmation" as const;

export const ScopeConfirmationContentSchema = z
  .object({
    type: z.literal(SCOPE_CONFIRMATION_KIND),
    frame_id: z.string().min(1),
    from_scope: ScopeKindSchema,
    to_scope: ScopeKindSchema,
    reason: z.string(),
    confirmed_by: z.string(),
  })
  .strict();

export type ScopeConfirmationContent = z.infer<typeof ScopeConfirmationContentSchema>;

export interface ScopePromotionRequest {
  frameId: string;
  fromScope: Frame["scope"]["kind"];
  toScope: Frame["scope"]["kind"];
  reason: string;
  confirmedAt: string;
  confirmedBy: string;
}

export interface ApplyScopePromotionOptions {
  projectRef?: string;
}

export class ScopePromotionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopePromotionError";
  }
}

/** Returns false when promotion would infer scope upward without confirmation. */
export function canPromoteScope(
  frame: Frame,
  targetScope: Frame["scope"]["kind"],
  confirmation?: Frame
): boolean {
  if (frame.scope.kind === targetScope) return true;
  if (!isUpwardPromotion(frame.scope.kind, targetScope)) return true;
  return confirmation !== undefined && isScopeConfirmationFor(confirmation, frame.id, targetScope);
}

export function isUpwardPromotion(
  from: Frame["scope"]["kind"],
  to: Frame["scope"]["kind"]
): boolean {
  const rank: Record<Frame["scope"]["kind"], number> = {
    project: 0,
    user: 1,
    universal: 2,
  };
  return rank[to] > rank[from];
}

export function isScopeConfirmationFor(
  confirmation: Frame,
  frameId: string,
  targetScope: Frame["scope"]["kind"]
): boolean {
  if (confirmation.kind !== "episodic") return false;
  const parsed = ScopeConfirmationContentSchema.safeParse(confirmation.content);
  if (!parsed.success) return false;
  return parsed.data.frame_id === frameId && parsed.data.to_scope === targetScope;
}

/** Apply scope promotion when confirmation is valid; throws otherwise. */
export function applyScopePromotion(
  frame: Frame,
  targetScope: Frame["scope"]["kind"],
  confirmation?: Frame,
  options: ApplyScopePromotionOptions = {}
): Frame {
  if (!canPromoteScope(frame, targetScope, confirmation)) {
    throw new ScopePromotionError(
      `Cannot promote frame ${frame.id} from ${frame.scope.kind} to ${targetScope} without explicit confirmation`
    );
  }

  if (frame.scope.kind === targetScope) return frame;

  if (targetScope === "project") {
    const projectRef =
      frame.scope.kind === "project" ? frame.scope.project_ref : options.projectRef;
    if (!projectRef) {
      throw new ScopePromotionError(
        `Cannot promote frame ${frame.id} to project scope without explicit project_ref`
      );
    }
    return createFrame({
      ...frame,
      scope: { kind: "project", project_ref: projectRef },
    });
  }

  return createFrame({
    ...frame,
    scope: { kind: targetScope },
  });
}

export function createScopeConfirmationFrame(request: ScopePromotionRequest): Frame {
  return createFrame({
    id: `scope-confirm-${request.frameId}-${request.toScope}`,
    kind: "episodic",
    content: {
      type: SCOPE_CONFIRMATION_KIND,
      frame_id: request.frameId,
      from_scope: request.fromScope,
      to_scope: request.toScope,
      reason: request.reason,
      confirmed_by: request.confirmedBy,
    },
    source: { surface: "amp", harness: "substrate" },
    created_at: request.confirmedAt,
    scope: { kind: request.toScope },
    curation_mode: "personal",
  });
}

export function validateScopeConfirmationFrame(input: unknown): boolean {
  const parsed = parseFrame(input);
  if (!parsed.success) return false;
  return (
    parsed.frame.kind === "episodic" &&
    ScopeConfirmationContentSchema.safeParse(parsed.frame.content).success
  );
}
