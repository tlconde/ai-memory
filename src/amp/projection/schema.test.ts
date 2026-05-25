import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import {
  DEFAULT_COMBINED_TOKEN_BUDGET,
  DEFAULT_FILE_TOKEN_TARGETS,
  PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER,
  PROJECTION_FILE_KINDS,
  PROJECTION_FILE_SPECS,
  PROJECTION_TRUNCATION_MARKER,
  createProjectionDocument,
  parseProjectionDocument,
  projectionFilePath,
  safeParseProjectionDocument,
} from "./index.js";

describe("ProjectionFileKindSchema and PROJECTION_FILE_SPECS", () => {
  it("defines all four projection kinds with scope and source metadata", () => {
    assert.equal(PROJECTION_FILE_KINDS.length, 4);
    for (const kind of PROJECTION_FILE_KINDS) {
      const spec = PROJECTION_FILE_SPECS[kind];
      assert.equal(spec.kind, kind);
      assert.ok(spec.default_token_target > 0);
      assert.match(spec.description, /\S/);
    }

    assert.equal(PROJECTION_FILE_SPECS.global_projection.scope, "global");
    assert.equal(PROJECTION_FILE_SPECS.global_projection.source_store, "knowledge");
    assert.equal(PROJECTION_FILE_SPECS.global_runtime.source_store, "runtime");
    assert.equal(PROJECTION_FILE_SPECS.project_projection.scope, "project");
    assert.equal(PROJECTION_FILE_SPECS.project_runtime.cadence, "session_start_and_runtime_change");
  });
});

describe("projectionFilePath", () => {
  it("resolves canonical global and project paths", () => {
    const home = "/Users/test";
    assert.equal(
      projectionFilePath("global_projection", { homedir: () => home }),
      join(home, ".amp", "projection", "global.md")
    );
    assert.equal(
      projectionFilePath("global_runtime", { homedir: () => home }),
      join(home, ".amp", "runtime", "global.md")
    );

    const projectRoot = "/repo/example";
    assert.equal(
      projectionFilePath("project_projection", { projectRoot }),
      join(projectRoot, ".amp", "local", "projection.md")
    );
    assert.equal(
      projectionFilePath("project_runtime", { projectRoot }),
      join(projectRoot, ".amp", "local", "runtime.md")
    );
  });

  it("requires projectRoot for project-scoped kinds", () => {
    assert.throws(
      () => projectionFilePath("project_projection"),
      /projectRoot is required/
    );
  });
});

describe("ProjectionMetadataHeaderSchema", () => {
  it("accepts metadata with generated_at, source_revision, scope, and budget", () => {
    const document = parseProjectionDocument(
      createProjectionDocument({
        kind: "global_projection",
        generated_at: "2026-05-25T12:00:00.000Z",
        source_revision: "knowledge-rev-42",
        token_count: 120,
        combined_count: 900,
      })
    );

    assert.equal(document.metadata.kind, "global_projection");
    assert.equal(document.metadata.scope, "global");
    assert.equal(document.metadata.generated_at, "2026-05-25T12:00:00.000Z");
    assert.equal(document.metadata.source_revision, "knowledge-rev-42");
    assert.equal(document.metadata.budget.token_target, DEFAULT_FILE_TOKEN_TARGETS.global_projection);
    assert.equal(document.metadata.budget.combined_cap, DEFAULT_COMBINED_TOKEN_BUDGET);
    assert.equal(document.metadata.budget.status, "ok");
  });

  it("requires project_ref for project-scoped projections", () => {
    const base = createProjectionDocument({ kind: "project_projection", project_ref: "my-app" });
    const parsed = safeParseProjectionDocument({
      ...base,
      metadata: { ...base.metadata, project_ref: undefined },
    });
    assert.equal(parsed.success, false);
  });

  it("rejects scope/kind mismatches", () => {
    const base = createProjectionDocument({ kind: "global_runtime" });
    const parsed = safeParseProjectionDocument({
      ...base,
      metadata: { ...base.metadata, scope: "project", project_ref: "x" },
    });
    assert.equal(parsed.success, false);
  });

  it("rejects unknown metadata keys", () => {
    const base = createProjectionDocument({ kind: "global_projection" });
    const parsed = safeParseProjectionDocument({
      ...base,
      metadata: { ...base.metadata, unexpected: true },
    });
    assert.equal(parsed.success, false);
  });
});

describe("ProjectionBudgetMetadataSchema", () => {
  it("accepts warning status when combined_count exceeds combined_cap", () => {
    const document = parseProjectionDocument(
      createProjectionDocument({
        kind: "project_runtime",
        token_count: 480,
        combined_count: DEFAULT_COMBINED_TOKEN_BUDGET + 1,
        status: "warning",
        truncated: true,
        truncation_marker: PROJECTION_TRUNCATION_MARKER,
      })
    );

    assert.equal(document.metadata.budget.status, "warning");
    assert.equal(document.metadata.budget.truncated, true);
    assert.equal(document.metadata.budget.truncation_marker, PROJECTION_TRUNCATION_MARKER);
  });

  it("rejects combined_count above hard-fail multiplier", () => {
    const hardCap = DEFAULT_COMBINED_TOKEN_BUDGET * PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER;
    const parsed = safeParseProjectionDocument(
      createProjectionDocument({
        kind: "global_projection",
        combined_count: hardCap + 1,
        status: "exceeded",
        truncated: true,
      })
    );
    assert.equal(parsed.success, false);
  });

  it("requires truncation_marker when truncated is true", () => {
    const base = createProjectionDocument({
      kind: "global_projection",
      status: "warning",
      truncated: true,
      combined_count: DEFAULT_COMBINED_TOKEN_BUDGET + 50,
    });
    const parsed = safeParseProjectionDocument({
      ...base,
      metadata: {
        ...base.metadata,
        budget: { ...base.metadata.budget, truncation_marker: undefined },
      },
    });
    assert.equal(parsed.success, false);
  });

  it("enforces per-kind token_target defaults", () => {
    for (const kind of PROJECTION_FILE_KINDS) {
      const document = createProjectionDocument({ kind });
      assert.equal(document.metadata.budget.token_target, DEFAULT_FILE_TOKEN_TARGETS[kind]);
    }
  });
});

describe("createProjectionDocument factory", () => {
  it("produces valid documents for each kind", () => {
    for (const kind of PROJECTION_FILE_KINDS) {
      const parsed = safeParseProjectionDocument(createProjectionDocument({ kind }));
      assert.equal(parsed.success, true);
    }
  });
});
