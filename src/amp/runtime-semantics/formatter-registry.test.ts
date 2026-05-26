import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  formatEpisodicFrameForRuntime,
  formatUnresolvedDecisionForRuntime,
  joinRuntimeProjectionLines,
} from "./format-projection.js";
import {
  FORMATTER_REGISTRY_KINDS,
  getFormatterRegistryEntry,
  isFormatterRegistryKind,
  isProjectableFormatterKind,
  resolveFormatterRegistryEntry,
  RUNTIME_FORMATTER_PROJECTION_ELIGIBILITY,
  RUNTIME_FORMATTER_REGISTRY,
} from "./formatter-registry.js";
import { RUNTIME_ENTITY_REGISTRY } from "./schema.js";

const ISO = "2026-05-26T12:00:00.000Z";

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

const ACTIVE_EPISODIC_FRAME = {
  id: "frame-1",
  event_type: "correction" as const,
  summary: "User corrected the storage approach",
  details: { backend: "sqlite" },
  tags: ["storage"],
  scope: "user" as const,
  curation_mode: "personal" as const,
  occurred_at: ISO,
  recorded_at: ISO,
  source_signals: ["signal-5"],
  related_entities: {},
  evidence_refs: ["evidence-1"],
  provenance: {
    transform_id: "frame-v1",
  },
  confidence: "high" as const,
  source: "user_explicit" as const,
  sensitivity: "secret_redacted" as const,
  visibility: "user_private" as const,
  pinned: false,
  lifecycle_state: "active" as const,
};

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
});

describe("projection eligibility policy", () => {
  it("marks rejected-signal-log as never projectable", () => {
    const entry = getFormatterRegistryEntry("rejected-signal-log");
    assert.equal(entry.projectionEligibility, "never");
    assert.equal(isProjectableFormatterKind("rejected-signal-log"), false);
  });

  it("marks dormant-snapshot as never projectable by default", () => {
    const entry = getFormatterRegistryEntry("dormant-snapshot");
    assert.equal(entry.projectionEligibility, "never");
    assert.equal(entry.renderable, false);
    assert.equal(isProjectableFormatterKind("dormant-snapshot"), false);
  });

  it("marks current-decision-leaning as sub-entity with no standalone projection", () => {
    const entry = getFormatterRegistryEntry("current-decision-leaning");
    assert.equal(entry.projectionEligibility, "never");
    assert.equal(entry.renderable, false);
    assert.deepEqual(entry.subEntity, {
      parentKind: "unresolved-decision",
      standaloneProjection: false,
    });
    assert.equal(entry.format, undefined);
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
});

describe("formatter wiring", () => {
  it("maps unresolved-decision to formatUnresolvedDecisionForRuntime", () => {
    const entry = getFormatterRegistryEntry("unresolved-decision");
    assert.equal(entry.schemaName, "UnresolvedDecision");
    assert.equal(entry.renderable, true);

    const direct = formatUnresolvedDecisionForRuntime(OPEN_DECISION);
    const viaRegistry = entry.format?.(OPEN_DECISION);
    assert.deepEqual(viaRegistry, direct);
  });

  it("maps episodic-frame to formatEpisodicFrameForRuntime with sensitivity redaction", () => {
    const entry = getFormatterRegistryEntry("episodic-frame");
    assert.equal(entry.schemaName, "EpisodicFrame");
    assert.equal(entry.sensitivityPolicy, "respect_episodic_sensitivity");

    const direct = formatEpisodicFrameForRuntime(ACTIVE_EPISODIC_FRAME);
    const viaRegistry = entry.format?.(ACTIVE_EPISODIC_FRAME);
    assert.deepEqual(viaRegistry, direct);

    const text = joinRuntimeProjectionLines(viaRegistry!.lines);
    assert.match(text, /metadata only/i);
    assert.match(text, /secret_redacted/i);
    assert.doesNotMatch(text, /User corrected the storage approach/);
  });
});

describe("registry entry completeness", () => {
  it("exposes schema and parse helpers for every registry entry", () => {
    for (const entry of RUNTIME_FORMATTER_REGISTRY) {
      assert.ok(entry.schema, `${entry.kind} missing schema`);
      assert.equal(typeof entry.parse, "function", `${entry.kind} missing parse`);
      assert.equal(typeof entry.safeParse, "function", `${entry.kind} missing safeParse`);
      assert.ok(entry.schemaName.length > 0, `${entry.kind} missing schemaName`);
    }
  });
});
