import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { joinInsideRoot, PathSafetyError } from "../../../path-safety/guard.js";
import { CURSOR_FROM_AMP_REL, CursorAdapter } from "./adapter.js";

describe("CursorAdapter path guards", () => {
  let projectRoot = "";
  let fromAmpRoot = "";

  before(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "amp-cursor-adapter-"));
    fromAmpRoot = join(projectRoot, CURSOR_FROM_AMP_REL);
    await mkdir(fromAmpRoot, { recursive: true });
  });

  after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("allows writes inside .cursor/rules/from-amp/", () => {
    const resolved = joinInsideRoot(fromAmpRoot, "PREF.mdc");
    assert.ok(resolved.endsWith("PREF.mdc"));
  });

  it("rejects writes outside from-amp", () => {
    assert.throws(
      () => joinInsideRoot(fromAmpRoot, "..", "outside.mdc"),
      PathSafetyError
    );
  });

  it("rejects path escape via adapter resolveWritePath", () => {
    const adapter = new CursorAdapter({ projectRoot });
    assert.throws(
      () => adapter.resolveWritePath("../rules/USER_AUTHORED.mdc"),
      PathSafetyError
    );
  });

  it("writes emitted rule content under from-amp", async () => {
    const adapter = new CursorAdapter({ projectRoot });
    const path = await adapter.writeEmittedRule(
      "TEST_RULE.mdc",
      "---\ndescription: test\nalwaysApply: false\n---\n"
    );
    assert.ok(path.includes("from-amp"));
  });
});
