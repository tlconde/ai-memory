import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HERMES_FROM_AMP_REL, HermesAdapter } from "./adapter.js";
import { PathSafetyError } from "../../../path-safety/guard.js";
import { createCanonicalProcedure } from "../../../procedural/schema.js";

describe("HermesAdapter path guards and I/O", () => {
  let projectRoot = "";

  before(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "amp-hermes-adapter-"));
    await mkdir(join(projectRoot, HERMES_FROM_AMP_REL), { recursive: true });
  });

  after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("allows writes inside skills/from-amp/<skill>/SKILL.md", () => {
    const adapter = new HermesAdapter({ projectRoot });
    const resolved = adapter.resolveSkillWritePath("mem-compound");
    assert.ok(resolved.includes(join("skills", "from-amp", "mem-compound", "SKILL.md")));
  });

  it("rejects path escape via resolveSkillWritePath", () => {
    const adapter = new HermesAdapter({ projectRoot });
    assert.throws(
      () => adapter.resolveSkillWritePath("../escape"),
      PathSafetyError
    );
  });

  it("writes emitted skill under skills/from-amp", async () => {
    const adapter = new HermesAdapter({ projectRoot });
    const path = await adapter.writeEmittedSkill(
      "test-skill",
      "---\nname: test-skill\ndescription: test\n---\n"
    );
    assert.ok(path.includes(join("skills", "from-amp", "test-skill", "SKILL.md")));
  });

  it("writes compiled canonical procedure under skills/from-amp/<name>/SKILL.md", async () => {
    const adapter = new HermesAdapter({ projectRoot });
    const procedure = createCanonicalProcedure({
      name: "compiled-skill",
      description: "Compiled through the Hermes adapter.",
      body: "# Compiled skill\n",
    });
    const path = await adapter.writeCompiledProcedure(procedure);
    assert.ok(path.includes(join("skills", "from-amp", "compiled-skill", "SKILL.md")));

    const written = await readFile(path, "utf8");
    assert.match(written, /^---\nname: compiled-skill/);
    assert.match(written, /# Compiled skill/);
  });

  it("reads back skill content after write", async () => {
    const adapter = new HermesAdapter({ projectRoot });
    const content = "---\nname: readback-skill\ndescription: readback\n---\n# Body\n";
    await adapter.writeEmittedSkill("readback-skill", content);
    const read = await adapter.readEmittedSkill("readback-skill");
    assert.equal(read, content);
  });

  it("lists emitted skills from skills/from-amp directory", async () => {
    const adapter = new HermesAdapter({ projectRoot });
    const listed = await adapter.listEmittedSkills();
    const names = listed.map((e) => e.skillName);
    assert.ok(names.includes("test-skill"));
    assert.ok(names.includes("compiled-skill"));
    assert.ok(names.includes("readback-skill"));
  });
});

/**
 * Live Hermes session load (`hermes -s <skill>`) with AMP-emitted skills is
 * PROVISIONAL/UNKNOWN in this repo until verified end-to-end; see
 * tools/cursor-sdk-amp-orchestrator/reports/amp-hermes-spike.md.
 */
