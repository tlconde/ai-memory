import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  gstackImportVersion,
  inferSupportedHarnesses,
  mapGstackToCanonicalProcedure,
  parseSkillMd,
  promoteGstackImportToUserVersion,
} from "./parse-skill-md.js";
import { ProcedureFrontmatterSchema } from "./schema.js";

describe("parseSkillMd", () => {
  it("splits frontmatter fence and body", () => {
    const parsed = parseSkillMd(`---
name: portable-skill
description: A portable helper.
version: 1.2.0
---
# Portable skill

Use anywhere.
`);

    assert.deepEqual(parsed.frontmatter, {
      name: "portable-skill",
      description: "A portable helper.",
      version: "1.2.0",
    });
    assert.equal(parsed.body, "# Portable skill\n\nUse anywhere.\n");
  });
});

describe("mapGstackToCanonicalProcedure", () => {
  it("maps gstack fields and AMP extensions", () => {
    const procedure = mapGstackToCanonicalProcedure(
      parseSkillMd(`---
name: mem-compound
description: Capture session learnings.
version: 2.1.0
triggers:
  - compound memory
tools:
  - commit_memory
mutating: true
---
# Mem compound
`),
      {
        ref: "abc123",
        mtime: "2026-05-27T10:00:00.000Z",
        skillDirName: "mem-compound",
      }
    );

    assert.equal(procedure.frontmatter.name, "mem-compound");
    assert.equal(procedure.frontmatter.version, "0.2.1.0.0");
    assert.equal(procedure.frontmatter.scope, "user");
    assert.equal(procedure.frontmatter.curation_mode, "llm_curated");
    assert.deepEqual(procedure.frontmatter.harness_compatibility.supported_harnesses, ["any"]);
    assert.equal(procedure.frontmatter.provenance?.upstream?.source_id, "gstack-main");
    assert.equal(procedure.frontmatter.provenance?.upstream?.ref, "abc123");
    assert.equal(ProcedureFrontmatterSchema.safeParse(procedure.frontmatter).success, true);
  });

  it("narrows harness compatibility for cursor-specific primitives", () => {
    const procedure = mapGstackToCanonicalProcedure(
      parseSkillMd(`---
name: cursor-search
description: Search the codebase.
---
Use @codebase to find relevant files.
`),
      {
        ref: "def456",
        mtime: "2026-05-27T11:00:00.000Z",
        skillDirName: "cursor-search",
      }
    );

    assert.deepEqual(procedure.frontmatter.harness_compatibility.supported_harnesses, ["cursor"]);
  });

  it("narrows harness compatibility for Claude slash commands", () => {
    const procedure = mapGstackToCanonicalProcedure(
      parseSkillMd(`---
name: claude-skill
description: Claude-only workflow.
---
Run /mem-compound after each session in Claude Code.
`),
      {
        ref: "ghi789",
        mtime: "2026-05-27T12:00:00.000Z",
        skillDirName: "claude-skill",
      }
    );

    assert.deepEqual(procedure.frontmatter.harness_compatibility.supported_harnesses, [
      "claude-code",
    ]);
  });
});

describe("gstackImportVersion", () => {
  it("prefixes gstack semver with 0.", () => {
    assert.equal(gstackImportVersion("1.2.3"), "0.1.2.3.0");
    assert.equal(gstackImportVersion("2.0"), "0.2.0.0");
  });
});

describe("promoteGstackImportToUserVersion", () => {
  it("promotes 0.x imports to 1.x", () => {
    assert.equal(promoteGstackImportToUserVersion("0.2.1.0.0"), "1.2.1");
    assert.equal(promoteGstackImportToUserVersion("1.0.0"), "1.0.0");
  });
});

describe("inferSupportedHarnesses", () => {
  it("defaults to any for portable skills", () => {
    assert.deepEqual(inferSupportedHarnesses("# Generic instructions\n"), ["any"]);
  });
});
