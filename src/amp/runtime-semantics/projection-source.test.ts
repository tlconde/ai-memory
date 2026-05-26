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
  type MaterializeRuntimeProjectionFromSourceResult,
  type RuntimeProjectionMaterializationSkip,
  type RuntimeProjectionMaterializationSkipReason,
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

interface SkipAuditExpectation {
  recordId: string;
  kind: RuntimeSemanticEntityRecord["kind"];
  reason: RuntimeProjectionMaterializationSkipReason;
  message?: string;
}

interface MaterializationSkipCase {
  name: string;
  entities: RuntimeSemanticEntityRecord[];
  expectedItemIds: string[];
  expectedSkips: SkipAuditExpectation[];
  assertResult?: (result: MaterializeRuntimeProjectionFromSourceResult) => void;
}

function materializeForFixture(
  entities: readonly RuntimeSemanticEntityRecord[],
  projectRef = FIXTURE_PROJECT_REF,
): MaterializeRuntimeProjectionFromSourceResult {
  return materializeRuntimeProjectionFromSource(
    new InMemoryRuntimeSemanticEntitySource(entities),
    { projectRef },
  );
}

function assertSkipAudit(
  skipped: readonly RuntimeProjectionMaterializationSkip[],
  expected: readonly SkipAuditExpectation[],
): void {
  assert.equal(skipped.length, expected.length, "skip count");
  for (const [index, exp] of expected.entries()) {
    const entry = skipped[index];
    assert.ok(entry, `missing skip entry at index ${index}`);
    assert.equal(entry.recordId, exp.recordId, `skip[${index}].recordId`);
    assert.equal(entry.kind, exp.kind, `skip[${index}].kind`);
    assert.equal(entry.reason, exp.reason, `skip[${index}].reason`);
    if (exp.message !== undefined) {
      assert.equal(entry.message, exp.message, `skip[${index}].message`);
    }
  }
}

function assertMaterializationCase(testCase: MaterializationSkipCase): void {
  const result = materializeForFixture(testCase.entities);
  assert.deepEqual(
    result.items.map((item) => item.id),
    testCase.expectedItemIds,
    `${testCase.name}: item ids`,
  );
  assertSkipAudit(result.skipped, testCase.expectedSkips);
  testCase.assertResult?.(result);
}

const DORMANT_SNAPSHOT_PAYLOAD = {
  frame_id: "frame-dormant-1",
  snapshot_version: 1,
  event_type: "correction" as const,
  summary_compressed: "Compressed summary",
  key_terms: ["storage"],
  encoding_context: {
    goal_ids: [] as string[],
    session_ids: [] as string[],
  },
  related_entities_compressed: {
    goal_ids: [] as string[],
    decision_ids: [] as string[],
    hypothesis_ids: [] as string[],
  },
  occurred_at: FIXTURE_ISO,
  dormancy_entered_at: FIXTURE_ISO,
  embedding: [0.1, 0.2],
  source: "user_explicit" as const,
  confidence_at_dormancy: "medium" as const,
  activation_history: {
    times_activated: 0,
  },
  generated_by: {
    transform_id: "snap-v1",
    cache_key: "cache-1",
  },
};

const MATERIALIZATION_SKIP_CASES: MaterializationSkipCase[] = [
  {
    name: "audits orphan current-decision-leaning records without a parent decision",
    entities: [
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
    ],
    expectedItemIds: [],
    expectedSkips: [
      {
        recordId: "lean-orphan",
        kind: "current-decision-leaning",
        reason: "orphan_sub_entity",
        message: "No parent unresolved-decision for decision_id missing-decision",
      },
    ],
  },
  {
    name: "skips rejected-signal-log and other non-projectable kinds with audit entries",
    entities: [
      {
        id: "rej-1",
        kind: "rejected-signal-log",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: REJECTED_SIGNAL,
      },
    ],
    expectedItemIds: [],
    expectedSkips: [
      {
        recordId: "rej-1",
        kind: "rejected-signal-log",
        reason: "not_projectable",
      },
    ],
  },
  {
    name: "skips entities whose scope does not match the target projectRef",
    entities: [
      {
        id: "dec-other",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: "other-project",
        payload: { ...OPEN_DECISION, id: "dec-other" },
      },
    ],
    expectedItemIds: [],
    expectedSkips: [
      {
        recordId: "dec-other",
        kind: "unresolved-decision",
        reason: "scope_mismatch",
      },
    ],
  },
  {
    name: "skips invalid payloads without throwing",
    entities: [
      {
        id: "dec-bad",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: FIXTURE_PROJECT_REF,
        payload: { id: "dec-bad" },
      },
    ],
    expectedItemIds: [],
    expectedSkips: [
      {
        recordId: "dec-bad",
        kind: "unresolved-decision",
        reason: "invalid_input",
      },
    ],
  },
  {
    name: "skips when record scope differs from parsed payload scope",
    entities: [
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
    ],
    expectedItemIds: [],
    expectedSkips: [
      {
        recordId: "pref-scope-mismatch",
        kind: "runtime-preference-candidate",
        reason: "record_payload_scope_mismatch",
      },
    ],
  },
  {
    name: "skips when record project_ref differs from parsed payload project_ref",
    entities: [
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
    ],
    expectedItemIds: [],
    expectedSkips: [
      {
        recordId: "pref-ref-mismatch",
        kind: "runtime-preference-candidate",
        reason: "record_payload_project_ref_mismatch",
      },
    ],
  },
  {
    name: "skips project-scoped payloads when record.project_ref is missing",
    entities: [
      {
        id: "dec-missing-ref",
        kind: "unresolved-decision",
        scope: "project",
        payload: OPEN_DECISION,
      },
    ],
    expectedItemIds: [],
    expectedSkips: [
      {
        recordId: "dec-missing-ref",
        kind: "unresolved-decision",
        reason: "missing_record_project_ref",
      },
    ],
  },
  {
    name: "keeps non-projectable entities failing safely before formatter invocation",
    entities: [
      {
        id: "dormant-1",
        kind: "dormant-snapshot",
        scope: "user",
        payload: DORMANT_SNAPSHOT_PAYLOAD,
      },
    ],
    expectedItemIds: [],
    expectedSkips: [
      {
        recordId: "dormant-1",
        kind: "dormant-snapshot",
        reason: "not_projectable",
      },
    ],
  },
  {
    name: "does not treat invalid parent decisions as parents via record.id fallback",
    entities: [
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
    ],
    expectedItemIds: [],
    expectedSkips: [
      {
        recordId: "dec-bad",
        kind: "unresolved-decision",
        reason: "invalid_input",
      },
      {
        recordId: "lean-for-dec-bad",
        kind: "current-decision-leaning",
        reason: "orphan_sub_entity",
      },
    ],
  },
  {
    name: "emits skip audit entries in source record order",
    entities: [
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
    ],
    expectedItemIds: ["pref-ok"],
    expectedSkips: [
      {
        recordId: "dec-invalid",
        kind: "unresolved-decision",
        reason: "invalid_input",
      },
      {
        recordId: "lean-orphan",
        kind: "current-decision-leaning",
        reason: "orphan_sub_entity",
      },
      {
        recordId: "rej-1",
        kind: "rejected-signal-log",
        reason: "not_projectable",
      },
    ],
  },
  {
    name: "audits duplicate compatible leanings and does not attach either",
    entities: [
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
    ],
    expectedItemIds: ["dec-1"],
    expectedSkips: [
      {
        recordId: "lean-a",
        kind: "current-decision-leaning",
        reason: "duplicate_sub_entity",
      },
      {
        recordId: "lean-b",
        kind: "current-decision-leaning",
        reason: "duplicate_sub_entity",
      },
    ],
    assertResult(result) {
      const withoutLeaning = formatParsedRuntimeEntityForProjection(
        "unresolved-decision",
        OPEN_DECISION,
      );
      assert.equal(withoutLeaning.ok, true);
      if (withoutLeaning.ok) {
        assert.deepEqual(result.items[0]?.formatted, withoutLeaning.formatted);
        assert.doesNotMatch(result.items[0]?.text ?? "", /Current leaning/i);
      }
    },
  },
  {
    name: "audits duplicate parent decisions and does not attach leanings to either",
    entities: [
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
    ],
    expectedItemIds: [],
    expectedSkips: [
      {
        recordId: "dec-record-1",
        kind: "unresolved-decision",
        reason: "duplicate_parent_entity",
      },
      {
        recordId: "dec-record-2",
        kind: "unresolved-decision",
        reason: "duplicate_parent_entity",
      },
      {
        recordId: "lean-duplicate-parent",
        kind: "current-decision-leaning",
        reason: "orphan_sub_entity",
      },
    ],
  },
];

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
  for (const testCase of MATERIALIZATION_SKIP_CASES) {
    it(testCase.name, () => {
      assertMaterializationCase(testCase);
    });
  }

  it("formats projectable entities into section-scoped projection text", () => {
    const result = materializeForFixture([
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

    const result = materializeForFixture([
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

  it("preserves source input order in materialized items", () => {
    const result = materializeForFixture([
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

    assert.deepEqual(
      result.items.map((item) => item.id),
      ["z-pref", "a-pref"],
    );
  });

  it("does not attach leanings across different project_ref envelopes", () => {
    const withoutLeaning = formatRuntimeEntityForProjection("unresolved-decision", OPEN_DECISION);
    assert.equal(withoutLeaning.ok, true);

    const result = materializeForFixture([
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

    assert.equal(result.items.length, 1);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.recordId, "lean-other-project");
    assert.equal(result.skipped[0]?.kind, "current-decision-leaning");
    assert.equal(result.skipped[0]?.reason, "sub_entity_envelope_mismatch");
    if (withoutLeaning.ok) {
      assert.deepEqual(result.items[0]?.formatted, withoutLeaning.formatted);
    }
  });

  it("does not attach leanings across user/project scope envelope mismatch", () => {
    const result = materializeForFixture([
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

    assert.equal(result.items.length, 1);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.recordId, "lean-user-scope");
    assert.equal(result.skipped[0]?.kind, "current-decision-leaning");
    assert.equal(result.skipped[0]?.reason, "sub_entity_envelope_mismatch");
    assert.doesNotMatch(result.items[0]?.text ?? "", /Current leaning/i);
  });

  it("still attaches a single valid leaning when only one compatible record exists", () => {
    const withLeaning = formatParsedRuntimeEntityForProjection("unresolved-decision", OPEN_DECISION, {
      currentLeaning: CURRENT_DECISION_LEANING,
    });
    assert.equal(withLeaning.ok, true);

    const result = materializeForFixture([
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

    assert.equal(result.items.length, 1);
    assert.equal(result.skipped.length, 0);
    if (withLeaning.ok) {
      assert.deepEqual(result.items[0]?.formatted, withLeaning.formatted);
    }
  });
});
