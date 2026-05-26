import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { RuntimeSemanticEntityRecord } from "./entity-record.js";
import { validateRuntimeSemanticEntityForStorage } from "./storage-validation.js";

const ISO = "2026-05-26T12:00:00.000Z";
const PROJECT_REF = "ai-memory";

const ACTIVE_PREFERENCE = {
  id: "pref-1",
  statement: "Keep responses short today",
  mode: "time_bounded" as const,
  scope: "user" as const,
  context: {},
  status: "active" as const,
  expires_at: ISO,
  first_observed_at: ISO,
  last_observed_at: ISO,
  source_signal_ids: ["signal-3"],
  confidence: "medium" as const,
  promotion_evidence: {
    repetition_count: 0,
    independent_sessions: 0,
  },
};

describe("validateRuntimeSemanticEntityForStorage", () => {
  it("rejects invalid scope without storage", () => {
    const result = validateRuntimeSemanticEntityForStorage({
      id: "bad-scope",
      kind: "runtime-preference-candidate",
      scope: "not-a-scope" as RuntimeSemanticEntityRecord["scope"],
      payload: ACTIVE_PREFERENCE,
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "invalid_scope");
    }
  });

  it("rejects unknown kind without storage", () => {
    const result = validateRuntimeSemanticEntityForStorage({
      id: "bad-kind",
      kind: "not-a-runtime-kind" as RuntimeSemanticEntityRecord["kind"],
      scope: "user",
      payload: {},
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "unknown_kind");
    }
  });

  it("rejects invalid payload without storage", () => {
    const result = validateRuntimeSemanticEntityForStorage({
      id: "dec-bad",
      kind: "unresolved-decision",
      scope: "project",
      project_ref: PROJECT_REF,
      payload: { id: "dec-bad" },
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "invalid_input");
    }
  });

  it("rejects record/payload scope mismatch without storage", () => {
    const result = validateRuntimeSemanticEntityForStorage({
      id: "pref-scope-mismatch",
      kind: "runtime-preference-candidate",
      scope: "user",
      payload: {
        ...ACTIVE_PREFERENCE,
        id: "pref-scope-mismatch",
        scope: "project",
        project_ref: PROJECT_REF,
      },
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "record_payload_scope_mismatch");
    }
  });

  it("rejects record/payload project_ref mismatch without storage", () => {
    const result = validateRuntimeSemanticEntityForStorage({
      id: "pref-ref-mismatch",
      kind: "runtime-preference-candidate",
      scope: "project",
      project_ref: PROJECT_REF,
      payload: {
        ...ACTIVE_PREFERENCE,
        id: "pref-ref-mismatch",
        scope: "project",
        project_ref: "other-project",
      },
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "record_payload_project_ref_mismatch");
    }
  });

  it("rejects missing record project_ref without storage", () => {
    const result = validateRuntimeSemanticEntityForStorage({
      id: "dec-missing-ref",
      kind: "unresolved-decision",
      scope: "project",
      payload: {
        id: "dec-missing-ref",
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
      },
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "missing_record_project_ref");
    }
  });

  it("accepts a valid record without storage", () => {
    const result = validateRuntimeSemanticEntityForStorage({
      id: "pref-1",
      kind: "runtime-preference-candidate",
      scope: "user",
      payload: ACTIVE_PREFERENCE,
    });

    assert.equal(result.ok, true);
  });
});
