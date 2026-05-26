import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AMP_LOCAL_DIR_REL } from "../gitignore/paths.js";
import {
  RUNTIME_CAPTURE_VERBATIM_MAX_CHARS,
  computeRuntimeCaptureSourceHash,
  evaluateRuntimeCaptureExclusionFilter,
  redactRuntimeCaptureExcerpt,
} from "./capture-exclusion-filter.js";
import { ACTIVE_PREFERENCE } from "./runtime-semantics.test-fixture.js";

describe("evaluateRuntimeCaptureExclusionFilter", () => {
  it("accepts task-relevant semantic content", () => {
    const result = evaluateRuntimeCaptureExclusionFilter({
      content: "Prefer SQLite for local AMP runtime storage in this project.",
      sourceSurface: "cursor",
      scope: "project",
      projectRef: "ai-memory",
    });

    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }

    assert.equal(result.accepted.source_surface, "cursor");
    assert.equal(
      result.accepted.source_hash,
      computeRuntimeCaptureSourceHash(
        "Prefer SQLite for local AMP runtime storage in this project.",
      ),
    );
  });

  it("echoes capture-eligible typed records on accept", () => {
    const captureRecord = {
      id: "pref-filter",
      kind: "runtime-preference-candidate" as const,
      scope: "user" as const,
      payload: { ...ACTIVE_PREFERENCE, id: "pref-filter" },
    };

    const result = evaluateRuntimeCaptureExclusionFilter({
      content: "Keep responses concise during reviews.",
      sourceSurface: "test",
      scope: "user",
      captureRecord,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.accepted.captureRecord, captureRecord);
    }
  });

  it("rejects credentials and secrets with redacted audit metadata", () => {
    const secret = "sk-abcdefghijklmnopqrstuvwxyz1234567890";
    const result = evaluateRuntimeCaptureExclusionFilter({
      content: `Store key ${secret} outside runtime memory.`,
      sourceSurface: "cursor",
      scope: "user",
    });

    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }

    assert.equal(result.rejected.reason_code, "credentials_or_secrets");
    assert.equal(result.rejected.source_surface, "cursor");
    assert.match(result.rejected.source_hash, /^sha256:[a-f0-9]{64}$/);
    assert.doesNotMatch(result.rejected.redacted_excerpt ?? "", new RegExp(secret));
    assert.match(result.rejected.redacted_excerpt ?? "", /\[REDACTED\]/);
  });

  it("rejects inferred emotional state readings", () => {
    const result = evaluateRuntimeCaptureExclusionFilter({
      content: "The user seems frustrated with the failing tests.",
      sourceSurface: "cursor",
      scope: "user",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.rejected.reason_code, "inferred_emotional_state");
    }
  });

  it("rejects telemetry without semantic content", () => {
    const result = evaluateRuntimeCaptureExclusionFilter({
      content: '{"latency_ms":123,"cpu_percent":45.2,"request_count":9}',
      sourceSurface: "metrics",
      scope: "universal",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.rejected.reason_code, "telemetry_without_semantic_content");
    }
  });

  it("rejects verbatim long content", () => {
    const result = evaluateRuntimeCaptureExclusionFilter({
      content: "x".repeat(RUNTIME_CAPTURE_VERBATIM_MAX_CHARS + 1),
      sourceSurface: "cursor",
      scope: "user",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.rejected.reason_code, "verbatim_long_content");
    }
  });

  it("rejects irrelevant private PII patterns", () => {
    const result = evaluateRuntimeCaptureExclusionFilter({
      content: "Contact SSN 123-45-6789 for billing.",
      sourceSurface: "cursor",
      scope: "user",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.rejected.reason_code, "irrelevant_private_pii");
      assert.match(result.rejected.redacted_excerpt ?? "", /\[REDACTED\]/);
    }
  });

  it("rejects runtime safety policy violations for AMP-managed paths", () => {
    const result = evaluateRuntimeCaptureExclusionFilter({
      content: `Dump runtime db from ${AMP_LOCAL_DIR_REL}state.db into git.`,
      sourceSurface: "cursor",
      scope: "project",
      projectRef: "ai-memory",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.rejected.reason_code, "runtime_safety_policy_violation");
    }
  });

  it("honors explicit exclusion hints from upstream classifiers", () => {
    const result = evaluateRuntimeCaptureExclusionFilter({
      content: "Public collaborator Dr. Ada Lovelace cited in the paper.",
      sourceSurface: "cursor",
      scope: "project",
      projectRef: "ai-memory",
      exclusionHint: "third_party_confidential_content",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.rejected.reason_code, "third_party_confidential_content");
      assert.equal(result.rejected.redacted_excerpt, undefined);
    }
  });

  it("rejects third-party confidential markers without storing semantic excerpts", () => {
    const result = evaluateRuntimeCaptureExclusionFilter({
      content: "This deck is CONFIDENTIAL and must not leave the team.",
      sourceSurface: "cursor",
      scope: "user",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.rejected.reason_code, "third_party_confidential_content");
      assert.equal(result.rejected.redacted_excerpt, undefined);
    }
  });

  it("rejects speculative identity claims", () => {
    const result = evaluateRuntimeCaptureExclusionFilter({
      content: "The user is probably an introvert based on chat style.",
      sourceSurface: "cursor",
      scope: "user",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.rejected.reason_code, "speculative_identity_claim");
    }
  });

  it("rejects unsourced domain conclusions", () => {
    const result = evaluateRuntimeCaptureExclusionFilter({
      content: "The operator is legally liable for the outage.",
      sourceSurface: "cursor",
      scope: "user",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.rejected.reason_code, "unsourced_domain_conclusion");
    }
  });
});

describe("redactRuntimeCaptureExcerpt", () => {
  it("returns undefined for blank content", () => {
    assert.equal(redactRuntimeCaptureExcerpt("   "), undefined);
  });
});
