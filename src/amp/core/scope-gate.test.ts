import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createFrame } from "./frame-schema.js";
import {
  applyScopePromotion,
  canPromoteScope,
  createScopeConfirmationFrame,
  ScopePromotionError,
} from "./scope-gate.js";

const PROJECT_FRAME = createFrame({
  id: "pref-001",
  kind: "semantic",
  content: "Use bun for scripts.",
  source: { surface: "cursor" },
  created_at: "2026-05-24T12:00:00.000Z",
  scope: { kind: "project", project_ref: "ai-memory" },
  curation_mode: "personal",
});

describe("scope promotion gate", () => {
  it("blocks project → user promotion without confirmation", () => {
    assert.equal(canPromoteScope(PROJECT_FRAME, "user"), false);
    assert.throws(
      () => applyScopePromotion(PROJECT_FRAME, "user"),
      ScopePromotionError
    );
  });

  it("allows project → user promotion with explicit confirmation frame", () => {
    const confirmation = createScopeConfirmationFrame({
      frameId: "pref-001",
      fromScope: "project",
      toScope: "user",
      reason: "user explicitly requested global preference",
      confirmedAt: "2026-05-24T12:05:00.000Z",
      confirmedBy: "user",
    });

    assert.equal(canPromoteScope(PROJECT_FRAME, "user", confirmation), true);
    const promoted = applyScopePromotion(PROJECT_FRAME, "user", confirmation);
    assert.equal(promoted.scope.kind, "user");
  });

  it("fails closed when promoting to project scope without project_ref", () => {
    const userFrame = createFrame({
      ...PROJECT_FRAME,
      id: "pref-user",
      scope: { kind: "user" },
    });

    assert.throws(
      () => applyScopePromotion(userFrame, "project"),
      ScopePromotionError
    );
  });

  it("promotes to project scope when explicit project_ref is supplied", () => {
    const userFrame = createFrame({
      ...PROJECT_FRAME,
      id: "pref-user",
      scope: { kind: "user" },
    });

    const promoted = applyScopePromotion(userFrame, "project", undefined, {
      projectRef: "ai-memory",
    });
    assert.equal(promoted.scope.kind, "project");
    assert.equal(promoted.scope.project_ref, "ai-memory");
  });
});
