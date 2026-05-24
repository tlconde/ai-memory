import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { compileProcedureToSkillMd } from "./compile-skill-md.js";
import { createCanonicalProcedure } from "./schema.js";

describe("compileProcedureToSkillMd", () => {
  it("uses folder-per-skill relative paths", () => {
    const compiled = compileProcedureToSkillMd(
      createCanonicalProcedure({ name: "mem-compound" })
    );

    assert.equal(compiled.skillName, "mem-compound");
    assert.equal(compiled.relativePath, "mem-compound/SKILL.md");
  });

  it("emits canonical frontmatter fields and procedure body", () => {
    const procedure = createCanonicalProcedure({
      name: "capture-preference",
      description: "Capture a scoped preference into AMP runtime.",
      version: "1.2.3",
      triggers: ["capture preference", "save preference"],
      tools: ["commit_memory"],
      mutating: true,
      writes_pages: false,
      writes_to: ["runtime"],
      scope: "project",
      curation_mode: "personal",
      amp_compatibility: {
        min_amp_version: "1.0",
        required_frame_kinds: ["semantic"],
        required_profile_slots: ["active_intent"],
        required_audiences: ["personal"],
      },
      harness_compatibility: {
        supported_harnesses: ["claude-code"],
        injection_path: "filesystem-native",
      },
      harness_overlays: {
        claude_code: { priority: 1 },
      },
      extends: ["base-procedure"],
      required_by: ["doctor"],
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
      body: "# Capture preference\n\nSteps here.\n",
    });

    const compiled = compileProcedureToSkillMd(procedure);

    assert.match(compiled.content, /^---\n/);
    assert.match(compiled.content, /\n---\n# Capture preference\n\nSteps here\.\n$/);
    assert.match(compiled.content, /name: capture-preference/);
    assert.match(compiled.content, /description: Capture a scoped preference into AMP runtime\./);
    assert.match(compiled.content, /version: 1\.2\.3/);
    assert.match(compiled.content, /- capture preference/);
    assert.match(compiled.content, /- save preference/);
    assert.match(compiled.content, /- commit_memory/);
    assert.match(compiled.content, /mutating: true/);
    assert.match(compiled.content, /writes_pages: false/);
    assert.match(compiled.content, /- runtime/);
    assert.match(compiled.content, /amp_artifact_version: '1\.0'/);
    assert.match(compiled.content, /scope: project/);
    assert.match(compiled.content, /curation_mode: personal/);
    assert.match(compiled.content, /min_amp_version: '1\.0'/);
    assert.match(compiled.content, /- semantic/);
    assert.match(compiled.content, /- active_intent/);
    assert.match(compiled.content, /- personal/);
    assert.match(compiled.content, /- claude-code/);
    assert.match(compiled.content, /injection_path: filesystem-native/);
    assert.match(compiled.content, /claude_code:\n\s+priority: 1/);
    assert.match(compiled.content, /- base-procedure/);
    assert.match(compiled.content, /- doctor/);
    assert.match(compiled.content, /- legacy-capture/);
    assert.match(compiled.content, /source: amp-registry/);
    assert.match(compiled.content, /created_at: '2026-05-25T00:00:00\.000Z'/);
    assert.match(compiled.content, /author: amp/);
    assert.match(compiled.content, /reason: Overlapping trigger phrases/);
  });

  it("is deterministic for identical input", () => {
    const procedure = createCanonicalProcedure({
      name: "doctor",
      description: "Run project health checks.",
      version: "0.2.0",
      triggers: ["check setup"],
      tools: ["search_memory"],
      mutating: false,
      harness_compatibility: {
        supported_harnesses: ["claude-code", "cursor"],
        injection_path: "either",
      },
      harness_overlays: {
        cursor: { globs: ["**/*.ts"], alwaysApply: false },
        gbrain: { resolver_priority: 2 },
      },
      body: "# Doctor\n",
    });

    const first = compileProcedureToSkillMd(procedure);
    const second = compileProcedureToSkillMd(procedure);

    assert.equal(first.content, second.content);
    assert.equal(first.relativePath, second.relativePath);
    assert.ok(first.content.endsWith("\n"));
  });

  it("preserves stable frontmatter key ordering", () => {
    const compiled = compileProcedureToSkillMd(createCanonicalProcedure({ name: "ordered-skill" }));
    const frontmatterBlock = compiled.content.split("\n---\n", 1)[0]?.replace(/^---\n/, "") ?? "";

    const keys = frontmatterBlock
      .split("\n")
      .filter((line) => /^[a-z_]+:/.test(line))
      .map((line) => line.replace(/:.*/, ""));

    assert.deepEqual(keys, [
      "name",
      "description",
      "version",
      "triggers",
      "tools",
      "mutating",
      "writes_pages",
      "writes_to",
      "amp_artifact_version",
      "scope",
      "curation_mode",
      "amp_compatibility",
      "harness_compatibility",
      "harness_overlays",
      "extends",
      "required_by",
      "conflicts_with",
      "conflicts",
    ]);
  });
});
