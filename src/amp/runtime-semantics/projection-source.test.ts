import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  formatParsedRuntimeEntityForProjection,
  formatRuntimeEntityForProjection,
  joinRuntimeProjectionLines,
} from "./index.js";
import {
  InMemoryRuntimeSemanticEntitySource,
  materializeRuntimeProjectionFromSource,
  resolveRuntimeSemanticEntitySection,
  type RuntimeSemanticEntityRecord,
} from "./projection-source.js";
import {
  ACTIVE_PREFERENCE,
  CURRENT_DECISION_LEANING,
  FIXTURE_ISO,
  FIXTURE_PROJECT_REF,
  OPEN_DECISION,
  REJECTED_SIGNAL,
} from "./runtime-semantics.test-fixture.js";

describe("resolveRuntimeSemanticEntitySection", () => {
  it("maps matching project scope to projectRuntime", () => {
    assert.equal(
      resolveRuntimeSemanticEntitySection(
        { scope: "project", project_ref: FIXTURE_PROJECT_REF },
        FIXTURE_PROJECT_REF,
      ),
      "projectRuntime",
    );
  });

  it("returns undefined for project scope with mismatched project_ref", () => {
    assert.equal(
      resolveRuntimeSemanticEntitySection(
        { scope: "project", project_ref: "other-project" },
        FIXTURE_PROJECT_REF,
      ),
      undefined,
    );
  });

  it("maps user and universal scope to globalRuntime", () => {
    assert.equal(
      resolveRuntimeSemanticEntitySection({ scope: "user" }, FIXTURE_PROJECT_REF),
      "globalRuntime",
    );
    assert.equal(
      resolveRuntimeSemanticEntitySection({ scope: "universal" }, FIXTURE_PROJECT_REF),
      "globalRuntime",
    );
  });
});

describe("InMemoryRuntimeSemanticEntitySource", () => {
  it("returns the configured entity records", () => {
    const entities = [
      {
        id: "pref-1",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: ACTIVE_PREFERENCE,
      },
    ];
    const source = new InMemoryRuntimeSemanticEntitySource(entities);
    assert.deepEqual(source.listEntities(), entities);
  });
});

describe("materializeRuntimeProjectionFromSource", () => {
  it("formats projectable entities into section-scoped projection text", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      {
        id: "pref-1",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: ACTIVE_PREFERENCE,
      },
      {
        id: "dec-1",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: OPEN_DECISION,
      },
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: FIXTURE_PROJECT_REF,
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
    const withLeaning = formatParsedRuntimeEntityForProjection("unresolved-decision", OPEN_DECISION, {
      currentLeaning: CURRENT_DECISION_LEANING,
    });
    assert.equal(withLeaning.ok, true);

    const source = new InMemoryRuntimeSemanticEntitySource([
      {
        id: "lean-1",
        kind: "current-decision-leaning",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: CURRENT_DECISION_LEANING,
      },
      {
        id: "dec-1",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: OPEN_DECISION,
      },
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: FIXTURE_PROJECT_REF,
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
      {
        id: "lean-orphan",
        kind: "current-decision-leaning",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: {
          ...CURRENT_DECISION_LEANING,
          decision_id: "missing-decision",
        },
      },
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: FIXTURE_PROJECT_REF,
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
      {
        id: "rej-1",
        kind: "rejected-signal-log",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: REJECTED_SIGNAL,
      },
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(result.items.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.reason, "not_projectable");
    assert.equal(result.skipped[0]?.kind, "rejected-signal-log");
  });

  it("skips entities whose scope does not match the target projectRef", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      {
        id: "dec-other",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: "other-project",
        payload: { ...OPEN_DECISION, id: "dec-other" },
      },
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(result.items.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.reason, "scope_mismatch");
  });

  it("skips invalid payloads without throwing", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      {
        id: "dec-bad",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: { id: "dec-bad" },
      },
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(result.items.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.reason, "invalid_input");
  });

  it("preserves source input order in materialized items", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      {
        id: "z-pref",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: { ...ACTIVE_PREFERENCE, id: "z-pref", statement: "Z preference" },
      },
      {
        id: "a-pref",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: { ...ACTIVE_PREFERENCE, id: "a-pref", statement: "A preference" },
      },
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.deepEqual(
      result.items.map((item) => item.id),
      ["z-pref", "a-pref"],
    );
  });

  it("skips when record scope differs from parsed payload scope", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      {
        id: "pref-scope-mismatch",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: {
          ...ACTIVE_PREFERENCE,
          id: "pref-scope-mismatch",
          scope: "project",
          project_ref: FIXTURE_PROJECT_REF,
        },
      },
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(result.items.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.reason, "record_payload_scope_mismatch");
  });

  it("skips when record project_ref differs from parsed payload project_ref", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      {
        id: "pref-ref-mismatch",
        kind: "runtime-preference-candidate",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: {
          ...ACTIVE_PREFERENCE,
          id: "pref-ref-mismatch",
          scope: "project",
          project_ref: "other-project",
        },
      },
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(result.items.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.reason, "record_payload_project_ref_mismatch");
  });

  it("skips project-scoped payloads when record.project_ref is missing", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      {
        id: "dec-missing-ref",
        kind: "unresolved-decision",
        scope: "project",
        payload: OPEN_DECISION,
      },
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(result.items.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.reason, "missing_record_project_ref");
  });

  it("keeps non-projectable entities failing safely before formatter invocation", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      {
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
          occurred_at: FIXTURE_ISO,
          dormancy_entered_at: FIXTURE_ISO,
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
      },
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(result.items.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.reason, "not_projectable");
    assert.equal(result.skipped[0]?.kind, "dormant-snapshot");
  });

  it("does not attach leanings across different project_ref envelopes", () => {
    const withoutLeaning = formatRuntimeEntityForProjection("unresolved-decision", OPEN_DECISION);
    assert.equal(withoutLeaning.ok, true);

    const source = new InMemoryRuntimeSemanticEntitySource([
      {
        id: "dec-1",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: OPEN_DECISION,
      },
      {
        id: "lean-other-project",
        kind: "current-decision-leaning",
        scope: "project",
        project_ref: "other-project",
        payload: CURRENT_DECISION_LEANING,
      },
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(result.items.length, 1);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.reason, "sub_entity_envelope_mismatch");
    if (withoutLeaning.ok) {
      assert.deepEqual(result.items[0]?.formatted, withoutLeaning.formatted);
    }
  });

  it("does not attach leanings across user/project scope envelope mismatch", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      {
        id: "dec-1",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: OPEN_DECISION,
      },
      {
        id: "lean-user-scope",
        kind: "current-decision-leaning",
        scope: "user",
        payload: CURRENT_DECISION_LEANING,
      },
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(result.items.length, 1);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.reason, "sub_entity_envelope_mismatch");
    assert.doesNotMatch(result.items[0]?.text ?? "", /Current leaning/i);
  });

  it("does not treat invalid parent decisions as parents via record.id fallback", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      {
        id: "dec-bad",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: { id: "dec-bad" },
      },
      {
        id: "lean-for-dec-bad",
        kind: "current-decision-leaning",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: {
          ...CURRENT_DECISION_LEANING,
          decision_id: "dec-bad",
        },
      },
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(result.items.length, 0);
    assert.equal(result.skipped.length, 2);
    assert.deepEqual(
      result.skipped.map((entry) => entry.recordId),
      ["dec-bad", "lean-for-dec-bad"],
    );
    assert.equal(result.skipped[0]?.reason, "invalid_input");
    assert.equal(result.skipped[1]?.reason, "orphan_sub_entity");
  });

  it("emits skip audit entries in source record order", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      {
        id: "pref-ok",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: { ...ACTIVE_PREFERENCE, id: "pref-ok" },
      },
      {
        id: "dec-invalid",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: { id: "dec-invalid" },
      },
      {
        id: "lean-orphan",
        kind: "current-decision-leaning",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: {
          ...CURRENT_DECISION_LEANING,
          decision_id: "missing-parent",
        },
      },
      {
        id: "rej-1",
        kind: "rejected-signal-log",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: REJECTED_SIGNAL,
      },
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.id, "pref-ok");
    assert.deepEqual(
      result.skipped.map((entry) => entry.recordId),
      ["dec-invalid", "lean-orphan", "rej-1"],
    );
    assert.deepEqual(
      result.skipped.map((entry) => entry.reason),
      ["invalid_input", "orphan_sub_entity", "not_projectable"],
    );
  });

  it("audits duplicate compatible leanings and does not attach either", () => {
    const withoutLeaning = formatParsedRuntimeEntityForProjection(
      "unresolved-decision",
      OPEN_DECISION,
    );
    assert.equal(withoutLeaning.ok, true);

    const source = new InMemoryRuntimeSemanticEntitySource([
      {
        id: "dec-1",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: OPEN_DECISION,
      },
      {
        id: "lean-a",
        kind: "current-decision-leaning",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: CURRENT_DECISION_LEANING,
      },
      {
        id: "lean-b",
        kind: "current-decision-leaning",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: {
          ...CURRENT_DECISION_LEANING,
          source_signal_id: "signal-lean-2",
        },
      },
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(result.items.length, 1);
    assert.equal(result.skipped.length, 2);
    assert.deepEqual(
      result.skipped.map((entry) => entry.recordId),
      ["lean-a", "lean-b"],
    );
    assert.deepEqual(
      result.skipped.map((entry) => entry.reason),
      ["duplicate_sub_entity", "duplicate_sub_entity"],
    );
    if (withoutLeaning.ok) {
      assert.deepEqual(result.items[0]?.formatted, withoutLeaning.formatted);
      assert.doesNotMatch(result.items[0]?.text ?? "", /Current leaning/i);
    }
  });

  it("audits duplicate parent decisions and does not attach leanings to either", () => {
    const source = new InMemoryRuntimeSemanticEntitySource([
      {
        id: "dec-record-1",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: OPEN_DECISION,
      },
      {
        id: "dec-record-2",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: {
          ...OPEN_DECISION,
          question: "Duplicate storage backend decision?",
        },
      },
      {
        id: "lean-duplicate-parent",
        kind: "current-decision-leaning",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: CURRENT_DECISION_LEANING,
      },
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(result.items.length, 0);
    assert.deepEqual(
      result.skipped.map((entry) => entry.recordId),
      ["dec-record-1", "dec-record-2", "lean-duplicate-parent"],
    );
    assert.deepEqual(
      result.skipped.map((entry) => entry.reason),
      ["duplicate_parent_entity", "duplicate_parent_entity", "orphan_sub_entity"],
    );
  });

  it("still attaches a single valid leaning when only one compatible record exists", () => {
    const withLeaning = formatParsedRuntimeEntityForProjection("unresolved-decision", OPEN_DECISION, {
      currentLeaning: CURRENT_DECISION_LEANING,
    });
    assert.equal(withLeaning.ok, true);

    const source = new InMemoryRuntimeSemanticEntitySource([
      {
        id: "lean-only",
        kind: "current-decision-leaning",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: CURRENT_DECISION_LEANING,
      },
      {
        id: "dec-1",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: OPEN_DECISION,
      },
    ]);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: FIXTURE_PROJECT_REF,
    });

    assert.equal(result.items.length, 1);
    assert.equal(result.skipped.length, 0);
    if (withLeaning.ok) {
      assert.deepEqual(result.items[0]?.formatted, withLeaning.formatted);
    }
  });
});
