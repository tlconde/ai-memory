import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CompileCursorError,
  compileProcedureToCursorMdc,
} from "./compile-cursor.js";
import { createCanonicalProcedure } from "./schema.js";

function parseMdcFrontmatter(content: string): {
  description: string;
  globs: string[];
  alwaysApply: boolean;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert.ok(match, "expected YAML frontmatter block");

  const frontmatter = match[1] ?? "";
  const body = match[2] ?? "";
  const descriptionMatch = frontmatter.match(/^description:\s(.+)$/m);
  assert.ok(descriptionMatch, "expected description frontmatter field");

  const alwaysApplyMatch = frontmatter.match(/^alwaysApply:\s(true|false)$/m);
  assert.ok(alwaysApplyMatch, "expected alwaysApply frontmatter field");

  let globs: string[] = [];
  if (/^globs:\s\[\]$/m.test(frontmatter)) {
    globs = [];
  } else {
    globs = [...frontmatter.matchAll(/^\s+-\s(.+)$/gm)].map((entry) =>
      JSON.parse(entry[1] ?? "")
    );
  }

  return {
    description: JSON.parse(descriptionMatch[1] ?? ""),
    globs,
    alwaysApply: alwaysApplyMatch[1] === "true",
    body,
  };
}

describe("compileProcedureToCursorMdc", () => {
  it("returns flat filename and round-trip frontmatter shape", () => {
    const procedure = createCanonicalProcedure({
      name: "capture-preference",
      description: "Capture a scoped preference into AMP runtime.",
      harness_overlays: {
        cursor: { globs: ["**/*.ts"], alwaysApply: false },
      },
      body: "# Capture preference\n\nSteps here.\n",
    });

    const compiled = compileProcedureToCursorMdc(procedure);
    assert.equal(compiled.filename, "capture-preference.mdc");

    const parsed = parseMdcFrontmatter(compiled.content);
    assert.equal(parsed.description, procedure.frontmatter.description);
    assert.deepEqual(parsed.globs, ["**/*.ts"]);
    assert.equal(parsed.alwaysApply, false);
    assert.equal(parsed.body, procedure.body);
  });

  it("emits deterministic bytes for the same input", () => {
    const procedure = createCanonicalProcedure({
      name: "doctor",
      description: "Run project health checks.",
      harness_overlays: {
        cursor: { globs: ["src/**/*.ts", "tests/**/*.ts"], alwaysApply: true },
      },
      body: "## Doctor\n\nCheck setup.\n",
    });

    const first = compileProcedureToCursorMdc(procedure);
    const second = compileProcedureToCursorMdc(procedure);
    assert.equal(first.content, second.content);
    assert.equal(
      first.content,
      [
        "---",
        'description: "Run project health checks."',
        "globs:",
        '  - "src/**/*.ts"',
        '  - "tests/**/*.ts"',
        "alwaysApply: true",
        "---",
        "## Doctor",
        "",
        "Check setup.",
        "",
      ].join("\n")
    );
  });

  it("maps cursor harness overlay defaults when overlay is absent", () => {
    const procedure = createCanonicalProcedure({
      name: "minimal",
      description: "Minimal procedure.",
      harness_overlays: {},
      body: "Body only.\n",
    });

    const compiled = compileProcedureToCursorMdc(procedure);
    const parsed = parseMdcFrontmatter(compiled.content);
    assert.deepEqual(parsed.globs, []);
    assert.equal(parsed.alwaysApply, false);
  });

  it("rejects invalid procedures", () => {
    const invalid = createCanonicalProcedure({ name: "bad/name" });
    assert.throws(
      () => compileProcedureToCursorMdc(invalid),
      CompileCursorError
    );
  });
});
