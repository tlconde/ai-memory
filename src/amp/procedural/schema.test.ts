import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createCanonicalProcedure,
  parseCanonicalProcedure,
  safeParseCanonicalProcedure,
} from "./schema.js";

describe("CanonicalProcedureSchema", () => {
  it("accepts frontmatter with provenance, overlays, and conflict metadata", () => {
    const procedure = parseCanonicalProcedure({
      frontmatter: {
        name: "capture-preference",
        description: "Capture a scoped preference into AMP runtime.",
        version: "1.0.0",
        triggers: ["capture preference"],
        tools: [],
        mutating: true,
        writes_pages: false,
        writes_to: ["runtime"],
        amp_artifact_version: "1.0",
        scope: "project",
        curation_mode: "personal",
        amp_compatibility: {
          min_amp_version: "1.0",
          required_frame_kinds: ["semantic"],
          required_profile_slots: ["active_intent"],
          required_audiences: ["personal"],
        },
        harness_compatibility: {
          supported_harnesses: ["cursor", "claude-code"],
          injection_path: "filesystem-native",
        },
        harness_overlays: {
          cursor: { globs: ["**/*.ts"], alwaysApply: false },
          gbrain: { resolver_priority: 3 },
        },
        extends: ["base-procedure"],
        required_by: [],
        conflicts_with: ["legacy-capture"],
        provenance: {
          source: "amp-registry",
          created_at: "2026-05-25T00:00:00.000Z",
          author: "amp",
        },
        conflicts: [
          {
            with: "legacy-capture",
            reason: "Overlapping trigger phrases",
            detected_at: "2026-05-25T00:00:00.000Z",
          },
        ],
      },
      body: "# Capture preference\n\nSteps here.\n",
    });

    assert.equal(procedure.frontmatter.name, "capture-preference");
    assert.equal(procedure.frontmatter.harness_overlays.cursor?.globs[0], "**/*.ts");
    assert.equal(procedure.frontmatter.conflicts[0]?.with, "legacy-capture");
    assert.match(procedure.body, /Capture preference/);
  });

  it("rejects shared curation_mode on procedures", () => {
    const parsed = safeParseCanonicalProcedure(
      createCanonicalProcedure({ curation_mode: "shared" as never })
    );
    assert.equal(parsed.success, false);
  });

  it("rejects unknown frontmatter keys", () => {
    const base = createCanonicalProcedure();
    const parsed = safeParseCanonicalProcedure({
      frontmatter: { ...base.frontmatter, unexpected: true },
      body: base.body,
    });
    assert.equal(parsed.success, false);
  });

  it("factory helper produces a valid canonical procedure", () => {
    const procedure = createCanonicalProcedure({ name: "doctor" });
    assert.equal(procedure.frontmatter.name, "doctor");
    assert.ok(procedure.body.length > 0);
    assert.doesNotThrow(() => parseCanonicalProcedure(procedure));
  });

  it("preserves provenance.upstream fields byte-identical on import round-trip", () => {
    const upstream = {
      source_id: "gstack-main",
      ref: "abc123def456",
      fetched_at: "2026-05-27T10:30:22.000Z",
      upstream_synced_at: "2026-05-27T10:30:22.000Z",
    };
    const input = {
      frontmatter: {
        ...createCanonicalProcedure().frontmatter,
        provenance: {
          source: "import" as const,
          created_at: "2026-05-25T00:00:00.000Z",
          author: "garrytan",
          notes: "gstack import",
          upstream,
        },
      },
      body: "# Imported procedure\n",
    };

    const procedure = parseCanonicalProcedure(input);
    assert.deepEqual(procedure.frontmatter.provenance?.upstream, upstream);
  });

  it("does not synthesize provenance.upstream for user-authored procedures", () => {
    const input = {
      frontmatter: {
        ...createCanonicalProcedure().frontmatter,
        provenance: {
          source: "user" as const,
          created_at: "2026-05-25T00:00:00.000Z",
        },
      },
      body: "# User procedure\n",
    };

    const procedure = parseCanonicalProcedure(input);
    assert.equal(procedure.frontmatter.provenance?.upstream, undefined);
  });
});
