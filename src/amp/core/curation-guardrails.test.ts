import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createFrame } from "./frame-schema.js";
import {
  applyCurationModeChange,
  canChangeCurationMode,
  createCurationModeConfirmationFrame,
  CurationModeGuardrailError,
  demoteFromShared,
  promoteToShared,
  requiresSharedCurationConfirmation,
} from "./curation-guardrails.js";

const PERSONAL_FRAME = createFrame({
  id: "fact-001",
  kind: "semantic",
  content: "Prefer strict TypeScript.",
  source: { surface: "cursor" },
  created_at: "2026-05-25T12:00:00.000Z",
  scope: { kind: "user" },
  curation_mode: "personal",
});

const SHARED_FRAME = createFrame({
  ...PERSONAL_FRAME,
  id: "fact-shared-001",
  curation_mode: "shared",
});

function confirmationFor(frameId: string, fromMode: "personal" | "llm_curated" | "shared", toMode: "personal" | "llm_curated" | "shared") {
  return createCurationModeConfirmationFrame({
    frameId,
    fromMode,
    toMode,
    reason: "user explicitly requested curation change",
    confirmedAt: "2026-05-25T12:05:00.000Z",
    confirmedBy: "user",
  });
}

describe("requiresSharedCurationConfirmation", () => {
  it("requires confirmation when entering shared", () => {
    assert.equal(requiresSharedCurationConfirmation("personal", "shared"), true);
  });

  it("requires confirmation when leaving shared", () => {
    assert.equal(requiresSharedCurationConfirmation("shared", "personal"), true);
  });

  it("does not require confirmation for personal ↔ llm_curated", () => {
    assert.equal(requiresSharedCurationConfirmation("personal", "llm_curated"), false);
    assert.equal(requiresSharedCurationConfirmation("llm_curated", "personal"), false);
  });
});

describe("shared curation guardrails", () => {
  it("blocks promotion to shared without confirmation", () => {
    assert.equal(canChangeCurationMode(PERSONAL_FRAME, "shared"), false);
    assert.throws(
      () => applyCurationModeChange(PERSONAL_FRAME, "shared"),
      CurationModeGuardrailError
    );
    assert.throws(
      () => promoteToShared(PERSONAL_FRAME, confirmationFor("wrong-id", "personal", "shared")),
      CurationModeGuardrailError
    );
  });

  it("promotes to shared with explicit confirmation", () => {
    const confirmation = confirmationFor("fact-001", "personal", "shared");
    assert.equal(canChangeCurationMode(PERSONAL_FRAME, "shared", confirmation), true);
    const promoted = promoteToShared(PERSONAL_FRAME, confirmation);
    assert.equal(promoted.curation_mode, "shared");
  });

  it("blocks demotion from shared without confirmation", () => {
    assert.equal(canChangeCurationMode(SHARED_FRAME, "personal"), false);
    assert.throws(
      () => demoteFromShared(SHARED_FRAME, "personal", confirmationFor("fact-shared-001", "shared", "llm_curated")),
      CurationModeGuardrailError
    );
  });

  it("demotes from shared with explicit confirmation", () => {
    const confirmation = confirmationFor("fact-shared-001", "shared", "personal");
    const demoted = demoteFromShared(SHARED_FRAME, "personal", confirmation);
    assert.equal(demoted.curation_mode, "personal");
  });

  it("allows personal ↔ llm_curated without shared confirmation", () => {
    const llmCurated = applyCurationModeChange(PERSONAL_FRAME, "llm_curated");
    assert.equal(llmCurated.curation_mode, "llm_curated");
  });
});
