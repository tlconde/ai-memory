import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ClaudeCodeAdapter } from "./adapter.js";
import { PathSafetyError } from "../../../path-safety/guard.js";

describe("ClaudeCodeAdapter path guards", () => {
  let basePath = "";

  before(async () => {
    basePath = await mkdtemp(join(tmpdir(), "amp-claude-adapter-"));
    await mkdir(join(basePath, "from-amp"), { recursive: true });
  });

  after(async () => {
    await rm(basePath, { recursive: true, force: true });
  });

  it("allows writes inside from-amp/<skill>/SKILL.md", () => {
    const adapter = new ClaudeCodeAdapter({ basePath });
    const resolved = adapter.resolveSkillWritePath("mem-compound");
    assert.ok(resolved.includes(join("from-amp", "mem-compound", "SKILL.md")));
  });

  it("rejects writes outside from-amp root", () => {
    const adapter = new ClaudeCodeAdapter({ basePath });
    assert.throws(
      () => adapter.resolveSkillWritePath("../escape", "SKILL.md"),
      PathSafetyError
    );
  });

  it("writes emitted skill under from-amp", async () => {
    const adapter = new ClaudeCodeAdapter({ basePath });
    const path = await adapter.writeEmittedSkill(
      "test-skill",
      "---\nname: test-skill\ndescription: test\n---\n"
    );
    assert.ok(path.includes(join("from-amp", "test-skill", "SKILL.md")));
  });
});
