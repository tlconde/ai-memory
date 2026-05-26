import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildLeaningAttachmentIndex } from "./leaning-attachments.js";

const ISO = "2026-05-26T12:00:00.000Z";
const PROJECT_REF = "ai-memory";

const OPEN_DECISION = {
  id: "dec-1",
  question: "Which storage backend?",
  status: "open" as const,
  scope: "project" as const,
  options: [
    {
      id: "opt-1",
      label: "SQLite",
      tradeoffs: ["local only"],
      evidence_refs: ["evidence-1"],
    },
  ],
  urgency: "medium" as const,
  owner: "user" as const,
  created_at: ISO,
  last_touched_at: ISO,
  provenance: ["signal-1"],
};

const CURRENT_LEANING = {
  decision_id: "dec-1",
  option_id: "opt-1",
  observed_at: ISO,
  source_signal_id: "signal-lean-1",
  freshness: "fresh" as const,
};

describe("buildLeaningAttachmentIndex", () => {
  it("indexes a single compatible leaning for attachment", () => {
    const index = buildLeaningAttachmentIndex([
      {
        record: {
          id: "dec-1",
          kind: "unresolved-decision",
          scope: "project",
          project_ref: PROJECT_REF,
        },
        parseResult: { success: true, value: OPEN_DECISION },
        hasEnvelopeSkip: false,
      },
      {
        record: {
          id: "lean-1",
          kind: "current-decision-leaning",
          scope: "project",
          project_ref: PROJECT_REF,
        },
        parseResult: { success: true, value: CURRENT_LEANING },
        hasEnvelopeSkip: false,
      },
    ]);

    assert.equal(index.byDecisionId.size, 1);
    assert.deepEqual(index.byDecisionId.get("dec-1"), CURRENT_LEANING);
    assert.equal(index.skipsByRecordId.size, 0);
  });

  it("skips orphan leanings without a parent decision", () => {
    const index = buildLeaningAttachmentIndex([
      {
        record: {
          id: "lean-orphan",
          kind: "current-decision-leaning",
          scope: "project",
          project_ref: PROJECT_REF,
        },
        parseResult: {
          success: true,
          value: { ...CURRENT_LEANING, decision_id: "missing-decision" },
        },
        hasEnvelopeSkip: false,
      },
    ]);

    assert.equal(index.byDecisionId.size, 0);
    assert.equal(index.skipsByRecordId.get("lean-orphan")?.reason, "orphan_sub_entity");
  });

  it("fail-closes duplicate compatible leanings", () => {
    const index = buildLeaningAttachmentIndex([
      {
        record: {
          id: "dec-1",
          kind: "unresolved-decision",
          scope: "project",
          project_ref: PROJECT_REF,
        },
        parseResult: { success: true, value: OPEN_DECISION },
        hasEnvelopeSkip: false,
      },
      {
        record: {
          id: "lean-a",
          kind: "current-decision-leaning",
          scope: "project",
          project_ref: PROJECT_REF,
        },
        parseResult: { success: true, value: CURRENT_LEANING },
        hasEnvelopeSkip: false,
      },
      {
        record: {
          id: "lean-b",
          kind: "current-decision-leaning",
          scope: "project",
          project_ref: PROJECT_REF,
        },
        parseResult: {
          success: true,
          value: { ...CURRENT_LEANING, source_signal_id: "signal-lean-2" },
        },
        hasEnvelopeSkip: false,
      },
    ]);

    assert.equal(index.byDecisionId.size, 0);
    assert.equal(index.skipsByRecordId.get("lean-a")?.reason, "duplicate_sub_entity");
    assert.equal(index.skipsByRecordId.get("lean-b")?.reason, "duplicate_sub_entity");
  });

  it("fail-closes duplicate parent decisions with the same payload id", () => {
    const index = buildLeaningAttachmentIndex([
      {
        record: {
          id: "dec-record-1",
          kind: "unresolved-decision",
          scope: "project",
          project_ref: PROJECT_REF,
        },
        parseResult: { success: true, value: OPEN_DECISION },
        hasEnvelopeSkip: false,
      },
      {
        record: {
          id: "dec-record-2",
          kind: "unresolved-decision",
          scope: "project",
          project_ref: PROJECT_REF,
        },
        parseResult: {
          success: true,
          value: { ...OPEN_DECISION, question: "Duplicate storage backend decision?" },
        },
        hasEnvelopeSkip: false,
      },
      {
        record: {
          id: "lean-duplicate-parent",
          kind: "current-decision-leaning",
          scope: "project",
          project_ref: PROJECT_REF,
        },
        parseResult: { success: true, value: CURRENT_LEANING },
        hasEnvelopeSkip: false,
      },
    ]);

    assert.equal(index.byDecisionId.size, 0);
    assert.equal(index.skipsByRecordId.get("dec-record-1")?.reason, "duplicate_parent_entity");
    assert.equal(index.skipsByRecordId.get("dec-record-2")?.reason, "duplicate_parent_entity");
    assert.equal(index.skipsByRecordId.get("lean-duplicate-parent")?.reason, "orphan_sub_entity");
  });

  it("skips leanings with envelope mismatch against the parent decision", () => {
    const index = buildLeaningAttachmentIndex([
      {
        record: {
          id: "dec-1",
          kind: "unresolved-decision",
          scope: "project",
          project_ref: PROJECT_REF,
        },
        parseResult: { success: true, value: OPEN_DECISION },
        hasEnvelopeSkip: false,
      },
      {
        record: {
          id: "lean-other-project",
          kind: "current-decision-leaning",
          scope: "project",
          project_ref: "other-project",
        },
        parseResult: { success: true, value: CURRENT_LEANING },
        hasEnvelopeSkip: false,
      },
    ]);

    assert.equal(index.byDecisionId.size, 0);
    assert.equal(
      index.skipsByRecordId.get("lean-other-project")?.reason,
      "sub_entity_envelope_mismatch",
    );
  });

  it("does not treat invalid parent decisions as parents", () => {
    const index = buildLeaningAttachmentIndex([
      {
        record: {
          id: "dec-bad",
          kind: "unresolved-decision",
          scope: "project",
          project_ref: PROJECT_REF,
        },
        parseResult: { success: false, error: "invalid decision payload" },
        hasEnvelopeSkip: false,
      },
      {
        record: {
          id: "lean-for-dec-bad",
          kind: "current-decision-leaning",
          scope: "project",
          project_ref: PROJECT_REF,
        },
        parseResult: {
          success: true,
          value: { ...CURRENT_LEANING, decision_id: "dec-bad" },
        },
        hasEnvelopeSkip: false,
      },
    ]);

    assert.equal(index.byDecisionId.size, 0);
    assert.equal(index.skipsByRecordId.get("lean-for-dec-bad")?.reason, "orphan_sub_entity");
  });
});
