import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { GBRAIN_UPSTREAM_SOURCE_ID } from "../procedural/parse-skill-md.js";
import { ProcedureFrontmatterSchema } from "../procedural/schema.js";
import {
  GBRAIN_SKILLS_DIR_ENV,
  GbrainSkillsSource,
  listGbrainProcedures,
  parseGbrainSkillsDir,
  resolveGbrainSkillsDir,
} from "./gbrain-skills-source.js";

const VALID_SKILL = `---
name: unit-valid-skill
description: Valid gbrain discovery skill.
version: 2.0.0
triggers:
  - unit probe
---
# Valid
`;

const BROKEN_SKILL = `---
name: unit-broken-skill
description: [unclosed yaml
version: 1.0.0
---
# Broken
`;

async function writeMiniGbrainSkillsDir(root: string): Promise<void> {
  await mkdir(join(root, "unit-valid-skill"), { recursive: true });
  await mkdir(join(root, "unit-broken-skill"), { recursive: true });
  await writeFile(join(root, "unit-valid-skill", "SKILL.md"), VALID_SKILL, "utf8");
  await writeFile(join(root, "unit-broken-skill", "SKILL.md"), BROKEN_SKILL, "utf8");
}

describe("resolveGbrainSkillsDir", () => {
  it("prefers --path over GBRAIN_SKILLS_DIR", () => {
    assert.equal(
      resolveGbrainSkillsDir("/explicit/path", { [GBRAIN_SKILLS_DIR_ENV]: "/env/path" }),
      "/explicit/path"
    );
  });

  it("falls back to GBRAIN_SKILLS_DIR when --path is omitted", () => {
    assert.equal(
      resolveGbrainSkillsDir(undefined, { [GBRAIN_SKILLS_DIR_ENV]: "/env/skills" }),
      "/env/skills"
    );
  });

  it("errors when neither --path nor env is set", () => {
    assert.throws(
      () => resolveGbrainSkillsDir(undefined, {}),
      /required: pass --path|does not guess/
    );
  });
});

describe("GbrainSkillsSource", () => {
  it("lists valid skills with ProcedureFrontmatterSchema-valid frontmatter", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-gbrain-source-valid-"));
    try {
      await writeMiniGbrainSkillsDir(tempDir);
      const results = await parseGbrainSkillsDir(tempDir, "unit-ref");
      const valid = results.filter((entry) => entry.procedure);
      assert.deepEqual(valid.map((entry) => entry.skillName), ["unit-valid-skill"]);
      assert.equal(
        valid[0]?.procedure?.frontmatter.provenance?.upstream?.source_id,
        GBRAIN_UPSTREAM_SOURCE_ID
      );
      for (const entry of valid) {
        assert.equal(
          ProcedureFrontmatterSchema.safeParse(entry.procedure!.frontmatter).success,
          true
        );
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("surfaces validation_error for invalid SKILL.md without auto-fixing", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-gbrain-source-broken-"));
    try {
      await writeMiniGbrainSkillsDir(tempDir);
      const results = await parseGbrainSkillsDir(tempDir, "unit-ref");
      const broken = results.find((entry) => entry.skillName === "unit-broken-skill");
      assert.ok(broken?.validation_error);
      assert.equal(broken?.procedure, undefined);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns discovery entries via listGbrainProcedures", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-gbrain-source-list-"));
    try {
      await writeMiniGbrainSkillsDir(tempDir);
      const list = await listGbrainProcedures({ skillsDir: tempDir, ref: "list-ref" });
      assert.equal(list.entries.length, 2);
      const broken = list.entries.find((entry) => entry.name === "unit-broken-skill");
      assert.ok(broken?.validation_error);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("parses optional RESOLVER.md without requiring it", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-gbrain-resolver-"));
    try {
      await mkdir(join(tempDir, "only-skill"), { recursive: true });
      await writeFile(
        join(tempDir, "only-skill", "SKILL.md"),
        `---
name: only-skill
description: Single skill fixture.
version: 1.0.0
---
# Only
`,
        "utf8"
      );
      await writeFile(
        join(tempDir, "RESOLVER.md"),
        `---
name: resolver-routing
description: Optional routing table stub.
version: 1.0.0
---
# Resolver
`,
        "utf8"
      );

      const source = new GbrainSkillsSource(tempDir);
      const results = await source.list();
      assert.equal(results.length, 1);
      assert.equal(results[0]?.skillName, "only-skill");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
