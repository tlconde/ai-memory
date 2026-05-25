import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PROJECTION_FILE_KINDS } from "./constants.js";
import { createProjectionDocument } from "./schema.js";
import { parseProjectionMarkdown, renderProjectionMarkdown } from "./render.js";

describe("renderProjectionMarkdown", () => {
  it("renders all four projection kinds with frontmatter and body", () => {
    for (const kind of PROJECTION_FILE_KINDS) {
      const document = createProjectionDocument({
        kind,
        body: `# ${kind}\n\nProjection content.\n`,
        ...(kind.startsWith("project_") ? { project_ref: "demo-app" } : {}),
      });

      const markdown = renderProjectionMarkdown(document);

      assert.match(markdown, /^---\n/);
      assert.match(markdown, new RegExp(`\\n---\\n# ${kind}\\n\\nProjection content\\.\\n$`));
      assert.match(markdown, /amp_projection_version: '1\.0'/);
      assert.match(markdown, new RegExp(`kind: ${kind}`));
      assert.match(markdown, /generated_at: '2026-05-25T00:00:00\.000Z'/);
      assert.match(markdown, /source_revision: rev-test-0001/);
      assert.match(markdown, /token_target: \d+/);
      assert.match(markdown, /combined_cap: 2000/);
    }
  });

  it("includes project_ref only for project-scoped kinds", () => {
    const globalMarkdown = renderProjectionMarkdown(
      createProjectionDocument({ kind: "global_projection" })
    );
    assert.doesNotMatch(globalMarkdown, /project_ref:/);

    const projectMarkdown = renderProjectionMarkdown(
      createProjectionDocument({ kind: "project_projection", project_ref: "my-app" })
    );
    assert.match(projectMarkdown, /project_ref: my-app/);
  });

  it("is deterministic for identical input", () => {
    const document = createProjectionDocument({
      kind: "global_runtime",
      generated_at: "2026-05-25T08:30:00.000Z",
      source_revision: "runtime-rev-7",
      token_count: 42,
      combined_count: 150,
      truncated: false,
      body: "# Runtime\n\nActive intent.\n",
    });

    const first = renderProjectionMarkdown(document);
    const second = renderProjectionMarkdown(document);

    assert.equal(first, second);
    assert.ok(first.endsWith("\n"));
  });

  it("preserves stable frontmatter key ordering for global projections", () => {
    const markdown = renderProjectionMarkdown(createProjectionDocument({ kind: "global_projection" }));
    const frontmatterBlock = markdown.split("\n---\n", 1)[0]?.replace(/^---\n/, "") ?? "";

    const keys = frontmatterBlock
      .split("\n")
      .filter((line) => /^[a-z_]+:/.test(line))
      .map((line) => line.replace(/:.*/, ""));

    assert.deepEqual(keys, [
      "amp_projection_version",
      "kind",
      "scope",
      "generated_at",
      "source_revision",
      "source_store",
      "cadence",
      "budget",
    ]);
  });

  it("preserves stable frontmatter key ordering for project projections", () => {
    const markdown = renderProjectionMarkdown(
      createProjectionDocument({ kind: "project_runtime", project_ref: "repo-x" })
    );
    const frontmatterBlock = markdown.split("\n---\n", 1)[0]?.replace(/^---\n/, "") ?? "";

    const keys = frontmatterBlock
      .split("\n")
      .filter((line) => /^[a-z_]+:/.test(line))
      .map((line) => line.replace(/:.*/, ""));

    assert.deepEqual(keys, [
      "amp_projection_version",
      "kind",
      "scope",
      "project_ref",
      "generated_at",
      "source_revision",
      "source_store",
      "cadence",
      "budget",
    ]);
  });

  it("preserves stable nested budget key ordering", () => {
    const markdown = renderProjectionMarkdown(
      createProjectionDocument({
        kind: "project_projection",
        project_ref: "budget-order",
        token_count: 100,
        combined_count: 1800,
        status: "warning",
        truncated: true,
        truncation_marker: "<!-- amp:truncated -->",
      })
    );
    const frontmatterBlock = markdown.split("\n---\n", 1)[0]?.replace(/^---\n/, "") ?? "";
    const budgetSection = frontmatterBlock.split(/^budget:\n/m)[1] ?? "";

    const budgetKeys = budgetSection
      .split("\n")
      .filter((line) => /^\s{2}[a-z_]+:/.test(line))
      .map((line) => line.trim().replace(/:.*/, ""));

    assert.deepEqual(budgetKeys, [
      "token_target",
      "token_count",
      "combined_cap",
      "combined_count",
      "status",
      "truncated",
      "truncation_marker",
    ]);
  });
});

describe("parseProjectionMarkdown", () => {
  it("round-trips rendered markdown through strict schema validation", () => {
    for (const kind of PROJECTION_FILE_KINDS) {
      const document = createProjectionDocument({
        kind,
        generated_at: "2026-05-25T15:45:00.000Z",
        source_revision: "round-trip-rev",
        token_count: 88,
        combined_count: 500,
        truncated: false,
        body: `# ${kind}\n\nRound-trip body.\n`,
        ...(kind.startsWith("project_") ? { project_ref: "round-trip-app" } : {}),
      });

      const markdown = renderProjectionMarkdown(document);
      const parsed = parseProjectionMarkdown(markdown);

      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.deepEqual(parsed.document, document);
      }
    }
  });

  it("rejects markdown with unknown frontmatter keys", () => {
    const markdown = renderProjectionMarkdown(createProjectionDocument({ kind: "global_projection" }));
    const tampered = markdown.replace(
      /source_revision: rev-test-0001/,
      "source_revision: rev-test-0001\nunexpected: true"
    );

    const parsed = parseProjectionMarkdown(tampered);
    assert.equal(parsed.success, false);
    assert.match(parsed.error ?? "", /schema validation/i);
  });

  it("rejects invalid markdown frontmatter", () => {
    const parsed = parseProjectionMarkdown("---\n: bad yaml\n---\n# Body\n");
    assert.equal(parsed.success, false);
    assert.match(parsed.error ?? "", /Invalid projection markdown/i);
  });
});
