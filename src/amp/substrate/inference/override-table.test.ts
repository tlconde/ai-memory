import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createCorrectionFrame } from "../../core/correction-frame.js";
import {
  applyCorrectionToOverrideTable,
  buildOverrideTableFromCorrections,
  createEmptyOverrideTable,
  lookupOverride,
  overrideLookupKey,
} from "./override-table.js";

const USER_SCOPE = { kind: "user" as const };

function correctionFrame(
  id: string,
  createdAt: string,
  classifier: string,
  fingerprint: string,
  previousOutput: unknown,
  correctedOutput: unknown
) {
  return createCorrectionFrame({
    id,
    correctionOfFrameId: "target-frame",
    classifier,
    previousOutput,
    correctedOutput,
    contextFingerprint: fingerprint,
    scope: USER_SCOPE,
    source: { surface: "cursor", harness: "cursor" },
    createdAt,
  });
}

describe("overrideLookupKey", () => {
  it("combines classifier and fingerprint deterministically", () => {
    const key = overrideLookupKey("kind_classifier", "fp-1");
    assert.equal(key.includes("kind_classifier"), true);
    assert.equal(key.includes("fp-1"), true);
  });
});

describe("buildOverrideTableFromCorrections", () => {
  it("indexes corrections by classifier and context fingerprint", () => {
    const table = buildOverrideTableFromCorrections(USER_SCOPE, [
      correctionFrame("c1", "2026-05-25T10:00:00.000Z", "kind_classifier", "fp-a", "semantic", "episodic"),
    ]);

    const result = lookupOverride(table, {
      classifier: "kind_classifier",
      contextFingerprint: "fp-a",
      previousOutput: "semantic",
    });

    assert.equal(result.hit, true);
    assert.equal(result.correctedOutput, "episodic");
  });

  it("latest correction wins for the same lookup key", () => {
    const table = buildOverrideTableFromCorrections(USER_SCOPE, [
      correctionFrame("c1", "2026-05-25T10:00:00.000Z", "kind_classifier", "fp-a", "semantic", "episodic"),
      correctionFrame("c2", "2026-05-25T11:00:00.000Z", "kind_classifier", "fp-a", "semantic", "crystal"),
    ]);

    const result = lookupOverride(table, {
      classifier: "kind_classifier",
      contextFingerprint: "fp-a",
      previousOutput: "semantic",
    });

    assert.equal(result.correctedOutput, "crystal");
    assert.equal(result.entry?.correctionFrameId, "c2");
  });

  it("misses when previous output does not match stored correction", () => {
    const table = buildOverrideTableFromCorrections(USER_SCOPE, [
      correctionFrame("c1", "2026-05-25T10:00:00.000Z", "kind_classifier", "fp-a", "semantic", "episodic"),
    ]);

    const result = lookupOverride(table, {
      classifier: "kind_classifier",
      contextFingerprint: "fp-a",
      previousOutput: "crystal",
    });

    assert.equal(result.hit, false);
  });

  it("misses when context fingerprint is unknown", () => {
    const table = createEmptyOverrideTable(USER_SCOPE);
    const updated = applyCorrectionToOverrideTable(
      table,
      correctionFrame("c1", "2026-05-25T10:00:00.000Z", "kind_classifier", "fp-a", "semantic", "episodic")
    );

    const result = lookupOverride(updated, {
      classifier: "kind_classifier",
      contextFingerprint: "fp-missing",
    });

    assert.equal(result.hit, false);
  });
});
