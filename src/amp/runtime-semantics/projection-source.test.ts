import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  formatRuntimeEntityForProjection,
  joinRuntimeProjectionLines,
} from "./index.js";
import {
  InMemoryRuntimeSemanticEntitySource,
  materializeRuntimeProjectionFromSource,
  resolveRuntimeSemanticEntitySection,
  type RuntimeSemanticEntityRecord,
} from "./projection-source.js";

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

const REJECTED_SIGNAL = {
  rejected_signal_id: "rej-1",
  timestamp: ISO,
  reason_code: "telemetry_without_semantic_content",
  source_surface: "cursor",
  scope: "project" as const,
  redacted_excerpt: "token=secret-value-should-not-leak",
  source_hash: "sha256:abc123",
};

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

function record(
  overrides: RuntimeSemanticEntityRecord,
): RuntimeSemanticEntityRecord {
  return overrides;
}

describe("resolveRuntimeSemanticEntitySection", () => {
  it("maps matching project scope to projectRuntime", () => {
    assert.equal(
      resolveRuntimeSemanticEntitySection(
        { scope: "project", project_ref: PROJECT_REF },
        PROJECT_REF,
      ),
      "projectRuntime",
    );
  });

  it("returns undefined for project scope with mismatched project_ref", () => {
    assert.equal(
      resolveRuntimeSemanticEntitySection(
        { scope: "project", project_ref: "other-project" },
        PROJECT_REF,
      ),
      undefined,
    );
  });

  it("maps user and universal scope to globalRuntime", () => {
    assert.equal(
      resolveRuntimeSemanticEntitySection({ scope: "user" }, PROJECT_REF),
      "globalRuntime",
    );
    assert.equal(
      resolveRuntimeSemanticEntitySection({ scope: "universal" }, PROJECT_REF),
      "globalRuntime",
    );
  });
});

describe("InMemoryRuntimeSemanticEntitySource", () => {
  it("returns the configured entity records", () => {
    const entities = [
      record({
        id: "pref-1",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: ACTIVE_PREFERENCE,
      }),
    ];
    const source = new InMemoryRuntimeSemanticEntitySource(entities);
    assert.deepEqual(source.listEntities(), entities);
  });
});

describe("materializeRuntimeProjectionFromSource", () => {
  it("formats projectable entities into section-scoped projection text", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      record({
        id: "pref-1",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: ACTIVE_PREFERENCE,
      }),
      record({
        id: "dec-1",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: PROJECT_REF,
        payload: OPEN_DECISION,
      }),
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: PROJECT_REF,
    });

    assert.equal(result.items.length, 2);
    assert.equal(result.skipped.length, 0);

    const preference = result.items.find((item) => item.id === "pref-1");
    assert.ok(preference);
    assert.equal(preference.section, "globalRuntime");
    assert.equal(preference.kind, "runtime-preference-candidate");
    assert.match(preference.text, /Keep responses short today/);

    const decision = result.items.find((item) => item.id === "dec-1");
    assert.ok(decision);
    assert.equal(decision.section, "projectRuntime");
    assert.match(decision.text, /Which storage backend/);
  });

  it("joins current-decision-leaning sub-entities onto parent decisions", () => {
    const withLeaning = formatRuntimeEntityForProjection("unresolved-decision", OPEN_DECISION, {
      currentLeaning: CURRENT_LEANING,
    });
    assert.equal(withLeaning.ok, true);

    const source = new InMemoryRuntimeSemanticEntitySource([
      record({
        id: "lean-1",
        kind: "current-decision-leaning",
        scope: "project",
        project_ref: PROJECT_REF,
        payload: CURRENT_LEANING,
      }),
      record({
        id: "dec-1",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: PROJECT_REF,
        payload: OPEN_DECISION,
      }),
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: PROJECT_REF,
    });

    assert.equal(result.items.length, 1);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.items[0]?.id, "dec-1");
    if (withLeaning.ok) {
      assert.deepEqual(result.items[0]?.formatted, withLeaning.formatted);
      assert.equal(
        result.items[0]?.text,
        joinRuntimeProjectionLines(withLeaning.formatted!.lines),
      );
    }
  });

  it("audits orphan current-decision-leaning records without a parent decision", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      record({
        id: "lean-orphan",
        kind: "current-decision-leaning",
        scope: "project",
        project_ref: PROJECT_REF,
        payload: {
          ...CURRENT_LEANING,
          decision_id: "missing-decision",
        },
      }),
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: PROJECT_REF,
    });

    assert.equal(result.items.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.deepEqual(result.skipped[0], {
      recordId: "lean-orphan",
      kind: "current-decision-leaning",
      reason: "orphan_sub_entity",
      message: "No parent unresolved-decision for decision_id missing-decision",
    });
  });

  it("skips rejected-signal-log and other non-projectable kinds with audit entries", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      record({
        id: "rej-1",
        kind: "rejected-signal-log",
        scope: "project",
        project_ref: PROJECT_REF,
        payload: REJECTED_SIGNAL,
      }),
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: PROJECT_REF,
    });

    assert.equal(result.items.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.reason, "not_projectable");
    assert.equal(result.skipped[0]?.kind, "rejected-signal-log");
  });

  it("skips entities whose scope does not match the target projectRef", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      record({
        id: "dec-other",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: "other-project",
        payload: { ...OPEN_DECISION, id: "dec-other" },
      }),
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: PROJECT_REF,
    });

    assert.equal(result.items.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.reason, "scope_mismatch");
  });

  it("skips invalid payloads without throwing", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      record({
        id: "dec-bad",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: PROJECT_REF,
        payload: { id: "dec-bad" },
      }),
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: PROJECT_REF,
    });

    assert.equal(result.items.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.reason, "invalid_input");
  });

  it("preserves source input order in materialized items", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      record({
        id: "z-pref",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: { ...ACTIVE_PREFERENCE, id: "z-pref", statement: "Z preference" },
      }),
      record({
        id: "a-pref",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: { ...ACTIVE_PREFERENCE, id: "a-pref", statement: "A preference" },
      }),
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: PROJECT_REF,
    });

    assert.deepEqual(
      result.items.map((item) => item.id),
      ["z-pref", "a-pref"],
    );
  });

  it("skips when record scope differs from parsed payload scope", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      record({
        id: "pref-scope-mismatch",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: {
          ...ACTIVE_PREFERENCE,
          id: "pref-scope-mismatch",
          scope: "project",
          project_ref: PROJECT_REF,
        },
      }),
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: PROJECT_REF,
    });

    assert.equal(result.items.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.reason, "record_payload_scope_mismatch");
  });

  it("skips when record project_ref differs from parsed payload project_ref", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      record({
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
      }),
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: PROJECT_REF,
    });

    assert.equal(result.items.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.reason, "record_payload_project_ref_mismatch");
  });

  it("skips project-scoped payloads when record.project_ref is missing", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      record({
        id: "dec-missing-ref",
        kind: "unresolved-decision",
        scope: "project",
        payload: OPEN_DECISION,
      }),
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: PROJECT_REF,
    });

    assert.equal(result.items.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.reason, "missing_record_project_ref");
  });

  it("keeps non-projectable entities failing safely through the formatter boundary", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      record({
        id: "dormant-1",
        kind: "dormant-snapshot",
        scope: "user",
        payload: {
          frame_id: "frame-dormant-1",
          snapshot_version: 1,
          event_type: "correction",
          summary_compressed: "Compressed summary",
          key_terms: ["storage"],
          encoding_context: {
            goal_ids: [],
            session_ids: [],
          },
          related_entities_compressed: {
            goal_ids: [],
            decision_ids: [],
            hypothesis_ids: [],
          },
          occurred_at: ISO,
          dormancy_entered_at: ISO,
          embedding: [0.1, 0.2],
          source: "user_explicit",
          confidence_at_dormancy: "medium",
          activation_history: {
            times_activated: 0,
          },
          generated_by: {
            transform_id: "snap-v1",
            cache_key: "cache-1",
          },
        },
      }),
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: PROJECT_REF,
    });

    assert.equal(result.items.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.reason, "not_projectable");
    assert.equal(result.skipped[0]?.kind, "dormant-snapshot");
  });
});
