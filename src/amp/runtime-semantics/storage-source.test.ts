import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  materializeRuntimeProjectionFromSource,
  type RuntimeSemanticEntityRecord,
} from "./projection-source.js";
import {
  RuntimeSemanticStorageEntitySource,
  type RuntimeSemanticEntityReader,
} from "./storage-source.js";

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

function record(
  overrides: RuntimeSemanticEntityRecord,
): RuntimeSemanticEntityRecord {
  return overrides;
}

class StubRuntimeSemanticEntityReader implements RuntimeSemanticEntityReader {
  readonly readCalls: number[] = [];

  constructor(private readonly entities: readonly RuntimeSemanticEntityRecord[]) {}

  readEntities(): readonly RuntimeSemanticEntityRecord[] {
    this.readCalls.push(this.readCalls.length);
    return this.entities;
  }
}

describe("RuntimeSemanticStorageEntitySource", () => {
  it("returns entity records from the reader", () => {
    const entities = [
      record({
        id: "pref-1",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: ACTIVE_PREFERENCE,
      }),
    ];
    const reader = new StubRuntimeSemanticEntityReader(entities);
    const source = new RuntimeSemanticStorageEntitySource(reader);

    assert.deepEqual(source.listEntities(), entities);
    assert.equal(reader.readCalls.length, 1);
  });

  it("delegates listEntities on each call without caching or mutation", () => {
    const entities = [
      record({
        id: "pref-1",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: ACTIVE_PREFERENCE,
      }),
    ];
    const reader = new StubRuntimeSemanticEntityReader(entities);
    const source = new RuntimeSemanticStorageEntitySource(reader);

    const first = source.listEntities();
    const second = source.listEntities();

    assert.deepEqual(first, entities);
    assert.deepEqual(second, entities);
    assert.equal(reader.readCalls.length, 2);
  });

  it("does not mutate entities returned by the reader", () => {
    const entities = [
      record({
        id: "pref-1",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: ACTIVE_PREFERENCE,
      }),
    ];
    const reader = new StubRuntimeSemanticEntityReader(entities);
    const source = new RuntimeSemanticStorageEntitySource(reader);

    const listed = source.listEntities();
    assert.deepEqual(listed, entities);
    assert.equal(listed, entities);
    assert.deepEqual(reader.readEntities(), entities);
  });

  it("only invokes reader readEntities and never mutates reader state", () => {
    const reader = new StubRuntimeSemanticEntityReader([]);
    const source = new RuntimeSemanticStorageEntitySource(reader);

    source.listEntities();
    source.listEntities();

    assert.deepEqual(reader.readCalls, [0, 1]);
  });
});

describe("materializeRuntimeProjectionFromSource with storage-backed adapter", () => {
  it("materializes projection text from reader-backed entities", () => {
    const reader = new StubRuntimeSemanticEntityReader([
      record({
        id: "pref-1",
        kind: "runtime-preference-candidate",
        scope: "user",
        payload: ACTIVE_PREFERENCE,
      }),
    ]);
    const source = new RuntimeSemanticStorageEntitySource(reader);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: PROJECT_REF,
    });

    assert.equal(result.items.length, 1);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.items[0]?.id, "pref-1");
    assert.match(result.items[0]?.text ?? "", /Keep responses short today/);
  });

  it("fails closed on invalid reader records via existing skip report", () => {
    const reader = new StubRuntimeSemanticEntityReader([
      record({
        id: "dec-bad",
        kind: "unresolved-decision",
        scope: "project",
        project_ref: PROJECT_REF,
        payload: { id: "dec-bad" },
      }),
    ]);
    const source = new RuntimeSemanticStorageEntitySource(reader);

    const result = materializeRuntimeProjectionFromSource(source, {
      projectRef: PROJECT_REF,
    });

    assert.equal(result.items.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.recordId, "dec-bad");
    assert.equal(result.skipped[0]?.reason, "invalid_input");
  });
});
