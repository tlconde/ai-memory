import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  formatEpisodicFrameForRuntime,
  formatHarnessOperationalStateForRuntime,
  formatRuntimeCrystalCandidateForRuntime,
  formatRuntimePreferenceCandidateForRuntime,
  formatUnresolvedDecisionForRuntime,
  joinRuntimeProjectionLines,
} from "./format-projection.js";
import {
  FORMATTER_REGISTRY_KINDS,
  formatParsedRuntimeEntityForProjection,
  formatRuntimeEntityForProjection,
  getFormatterRegistryEntry,
  isFormatterRegistryKind,
  isProjectableFormatterKind,
  parseRuntimeEntityAtBoundary,
  PROJECTABLE_FORMATTER_KINDS,
  resolveFormatterRegistryEntry,
  RUNTIME_FORMATTER_PROJECTION_ELIGIBILITY,
  RUNTIME_FORMATTER_REGISTRY,
  type FormatterRegistryKind,
} from "./formatter-registry.js";
import { RUNTIME_ENTITY_REGISTRY } from "./schema.js";
import {
  CORRECTION_EPISODIC_FRAME,
  DORMANT_SNAPSHOT,
  FIXTURE_ISO,
} from "./runtime-semantics.test-fixture.js";

const ISO = FIXTURE_ISO;

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

const ACTIVE_CRYSTAL = {
  id: "hyp-1",
  claim: "Cursor works best for refactors in this repo",
  status: "active" as const,
  scope: "project" as const,
  project_ref: "ai-memory",
  related_goal_ids: [],
  related_decision_ids: [],
  supporting_evidence_refs: ["evidence-a"],
  contradicting_evidence_refs: [],
  predicted_observations: [],
  successful_predictions: [],
  failed_predictions: [],
  confidence: "low" as const,
  contradiction_score: "low" as const,
  pinned: false,
  first_observed_at: ISO,
  last_referenced_at: ISO,
  source_signal_ids: [],
  lineage: {
    generated_by: "agent" as const,
  },
};

const HARNESS_STATE = {
  id: "harness-1",
  harness: "cursor",
  project_ref: "ai-memory",
  status: "active" as const,
  observed_at: ISO,
  source_signal_ids: ["signal-4"],
};

const ACTIVE_EPISODIC_FRAME = {
  ...CORRECTION_EPISODIC_FRAME,
  sensitivity: "secret_redacted" as const,
};

const EXPECTED_PROJECTABLE_KINDS = [
  "unresolved-decision",
  "runtime-preference-candidate",
  "runtime-crystal-candidate",
  "harness-operational-state",
  "episodic-frame",
] as const;

describe("RUNTIME_FORMATTER_REGISTRY coverage", () => {
  it("includes every RUNTIME_ENTITY_REGISTRY kind", () => {
    for (const { kind } of RUNTIME_ENTITY_REGISTRY) {
      assert.ok(
        isFormatterRegistryKind(kind),
        `missing formatter registry entry for ${kind}`,
      );
    }
  });

  it("includes the current-decision-leaning sub-entity", () => {
    assert.ok(isFormatterRegistryKind("current-decision-leaning"));
    assert.equal(FORMATTER_REGISTRY_KINDS.length, RUNTIME_ENTITY_REGISTRY.length + 1);
  });

  it("rejects unknown kind slugs", () => {
    assert.equal(isFormatterRegistryKind("not-a-runtime-kind"), false);
    assert.equal(resolveFormatterRegistryEntry("not-a-runtime-kind"), undefined);
    assert.throws(
      () => getFormatterRegistryEntry("not-a-runtime-kind" as never),
      /Unknown formatter registry kind/,
    );
  });

  it("gives every registry kind schema and policy", () => {
    for (const entry of RUNTIME_FORMATTER_REGISTRY) {
      assert.ok(entry.schema, `${entry.kind} missing schema`);
      assert.equal(typeof entry.safeParse, "function", `${entry.kind} missing safeParse`);
      assert.ok(entry.schemaName.length > 0, `${entry.kind} missing schemaName`);
      assert.ok(entry.policy, `${entry.kind} missing policy`);
      assert.ok(
        entry.policy.projectionEligibility,
        `${entry.kind} missing projectionEligibility`,
      );
    }
  });

  it("derives schemaName from RUNTIME_ENTITY_REGISTRY for entity kinds", () => {
    for (const { kind, schemaName } of RUNTIME_ENTITY_REGISTRY) {
      assert.equal(getFormatterRegistryEntry(kind).schemaName, schemaName);
    }
  });
});

describe("projection eligibility policy", () => {
  it("marks rejected-signal-log as never projectable", () => {
    const entry = getFormatterRegistryEntry("rejected-signal-log");
    assert.equal(entry.policy.projectionEligibility, "never");
    assert.equal(isProjectableFormatterKind("rejected-signal-log"), false);
  });

  it("marks dormant-snapshot as never projectable by default", () => {
    const entry = getFormatterRegistryEntry("dormant-snapshot");
    assert.equal(entry.policy.projectionEligibility, "never");
    assert.equal(entry.policy.renderable, false);
    assert.equal(isProjectableFormatterKind("dormant-snapshot"), false);
  });

  it("marks current-decision-leaning as sub-entity with no standalone projection", () => {
    const entry = getFormatterRegistryEntry("current-decision-leaning");
    assert.equal(entry.policy.projectionEligibility, "never");
    assert.equal(entry.policy.renderable, false);
    assert.deepEqual(entry.policy.subEntity, {
      parentKind: "unresolved-decision",
      standaloneProjection: false,
    });
  });

  it("keeps projection eligibility values stable", () => {
    assert.deepEqual(RUNTIME_FORMATTER_PROJECTION_ELIGIBILITY, {
      "unresolved-decision": "both",
      "current-decision-leaning": "never",
      "runtime-preference-candidate": "both",
      "runtime-crystal-candidate": "both",
      "harness-operational-state": "both",
      "rejected-signal-log": "never",
      "episodic-frame": "both",
      "dormant-snapshot": "never",
    });
  });

  it("lists exactly the expected projectable kinds", () => {
    assert.deepEqual([...PROJECTABLE_FORMATTER_KINDS].sort(), [
      ...EXPECTED_PROJECTABLE_KINDS,
    ].sort());
    for (const kind of EXPECTED_PROJECTABLE_KINDS) {
      assert.equal(isProjectableFormatterKind(kind), true);
    }
    assert.equal(isProjectableFormatterKind("rejected-signal-log"), false);
    assert.equal(isProjectableFormatterKind("current-decision-leaning"), false);
    assert.equal(isProjectableFormatterKind("dormant-snapshot"), false);
  });
});

describe("formatRuntimeEntityForProjection", () => {
  it("returns invalid_input for unknown payloads without throwing", () => {
    const result = formatRuntimeEntityForProjection("unresolved-decision", {
      id: "dec-bad",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "invalid_input");
      assert.match(result.error, /Required|Invalid|expected/i);
    }
  });

  it("returns unknown_kind for unsupported kind slugs without throwing", () => {
    const result = formatRuntimeEntityForProjection(
      "not-a-kind" as FormatterRegistryKind,
      OPEN_DECISION,
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "unknown_kind");
    }
  });

  it("blocks rejected-signal-log from projection formatting", () => {
    const result = formatRuntimeEntityForProjection("rejected-signal-log", REJECTED_SIGNAL);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "not_projectable");
      assert.match(result.error, /not projectable/i);
    }
  });

  it("blocks current-decision-leaning from standalone projection formatting", () => {
    const result = formatRuntimeEntityForProjection(
      "current-decision-leaning",
      CURRENT_LEANING,
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "not_projectable");
    }
  });

  it("blocks dormant-snapshot from standalone projection formatting", () => {
    const result = formatRuntimeEntityForProjection("dormant-snapshot", DORMANT_SNAPSHOT);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "not_projectable");
    }
  });

  it("formats unresolved-decision through the typed helper", () => {
    const direct = formatUnresolvedDecisionForRuntime(OPEN_DECISION);
    const result = formatRuntimeEntityForProjection("unresolved-decision", OPEN_DECISION);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.formatted, direct);
    }
  });

  it("redacts episodic-frame secret_redacted content through the typed helper", () => {
    const direct = formatEpisodicFrameForRuntime(ACTIVE_EPISODIC_FRAME);
    const result = formatRuntimeEntityForProjection("episodic-frame", ACTIVE_EPISODIC_FRAME);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.formatted, direct);
      const text = joinRuntimeProjectionLines(result.formatted!.lines);
      assert.match(text, /metadata only/i);
      assert.match(text, /secret_redacted/i);
      assert.doesNotMatch(text, /User corrected the storage approach/);
    }
  });

  it("formats every projectable kind through the typed helper", () => {
    const cases = [
      {
        kind: "runtime-preference-candidate" as const,
        entity: ACTIVE_PREFERENCE,
        direct: formatRuntimePreferenceCandidateForRuntime(ACTIVE_PREFERENCE),
      },
      {
        kind: "runtime-crystal-candidate" as const,
        entity: ACTIVE_CRYSTAL,
        direct: formatRuntimeCrystalCandidateForRuntime(ACTIVE_CRYSTAL),
      },
      {
        kind: "harness-operational-state" as const,
        entity: HARNESS_STATE,
        direct: formatHarnessOperationalStateForRuntime(HARNESS_STATE),
      },
    ];

    for (const { kind, entity, direct } of cases) {
      const result = formatRuntimeEntityForProjection(kind, entity);
      assert.equal(result.ok, true, `${kind} should format successfully`);
      if (result.ok) {
        assert.deepEqual(result.formatted, direct, `${kind} should match direct formatter`);
      }
    }
  });
});

describe("formatParsedRuntimeEntityForProjection", () => {
  it("formats valid parsed values without requiring boundary input", () => {
    const direct = formatUnresolvedDecisionForRuntime(OPEN_DECISION);
    const result = formatParsedRuntimeEntityForProjection(
      "unresolved-decision",
      OPEN_DECISION,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.formatted, direct);
    }
  });

  it("blocks non-projectable kinds without re-parsing", () => {
    const rejected = formatParsedRuntimeEntityForProjection(
      "rejected-signal-log",
      REJECTED_SIGNAL,
    );
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.equal(rejected.reason, "not_projectable");
    }

    const dormant = formatParsedRuntimeEntityForProjection(
      "dormant-snapshot",
      DORMANT_SNAPSHOT,
    );
    assert.equal(dormant.ok, false);
    if (!dormant.ok) {
      assert.equal(dormant.reason, "not_projectable");
    }
  });

  it("matches boundary helper output for projectable parsed values", () => {
    const boundary = formatRuntimeEntityForProjection(
      "runtime-preference-candidate",
      ACTIVE_PREFERENCE,
    );
    const parsed = formatParsedRuntimeEntityForProjection(
      "runtime-preference-candidate",
      ACTIVE_PREFERENCE,
    );
    assert.deepEqual(parsed, boundary);
  });
});

describe("parseRuntimeEntityAtBoundary", () => {
  it("validates payloads at the registry boundary", () => {
    const parsed = parseRuntimeEntityAtBoundary("unresolved-decision", OPEN_DECISION);
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.equal(parsed.value.id, "dec-1");
    }

    const invalid = parseRuntimeEntityAtBoundary("unresolved-decision", { id: "bad" });
    assert.equal(invalid.success, false);
  });
});
