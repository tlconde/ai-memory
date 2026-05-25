import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_COMBINED_TOKEN_BUDGET,
  PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER,
  PROJECTION_FILE_KINDS,
  createProjectionDocument,
} from "./index.js";
import {
  ProjectionMetadataReconcileError,
  reconcileProjectionMetadata,
} from "./reconcile.js";

function doc(kind: (typeof PROJECTION_FILE_KINDS)[number], tokenCount: number) {
  return createProjectionDocument({
    kind,
    token_count: tokenCount,
    combined_count: 9999,
    status: "warning",
    truncated: true,
  });
}

describe("reconcileProjectionMetadata", () => {
  it("recomputes combined_count, combined_cap, and status from per-file token_count", () => {
    const input = [
      doc("global_projection", 400),
      doc("global_runtime", 200),
      doc("project_projection", 600),
      doc("project_runtime", 400),
    ];

    const reconciled = reconcileProjectionMetadata(input);

    assert.equal(reconciled.length, 4);
    for (const document of reconciled) {
      assert.equal(document.metadata.budget.combined_cap, DEFAULT_COMBINED_TOKEN_BUDGET);
      assert.equal(document.metadata.budget.combined_count, 1600);
      assert.equal(document.metadata.budget.status, "ok");
      assert.equal(document.metadata.budget.truncated, false);
      assert.equal(document.metadata.budget.truncation_marker, undefined);
    }
  });

  it("does not mutate input documents", () => {
    const input = [doc("global_projection", 100)];
    const snapshot = structuredClone(input);

    reconcileProjectionMetadata(input);

    assert.deepEqual(input, snapshot);
  });

  it("marks warning status when combined count exceeds cap but not hard cap", () => {
    const overCap = DEFAULT_COMBINED_TOKEN_BUDGET + 50;
    const reconciled = reconcileProjectionMetadata([doc("global_projection", overCap)]);

    assert.equal(reconciled[0]?.metadata.budget.combined_count, overCap);
    assert.equal(reconciled[0]?.metadata.budget.status, "warning");
    assert.equal(reconciled[0]?.metadata.budget.truncated, true);
    assert.ok(reconciled[0]?.metadata.budget.truncation_marker);
  });

  it("accepts a custom combined cap", () => {
    const customCap = 500;
    const reconciled = reconcileProjectionMetadata([doc("global_projection", 600)], {
      combinedCap: customCap,
    });

    assert.equal(reconciled[0]?.metadata.budget.combined_cap, customCap);
    assert.equal(reconciled[0]?.metadata.budget.combined_count, 600);
    assert.equal(reconciled[0]?.metadata.budget.status, "warning");
  });

  it("preserves per-file token_count and other metadata fields", () => {
    const input = [
      createProjectionDocument({
        kind: "project_projection",
        project_ref: "repo-a",
        source_revision: "rev-abc",
        generated_at: "2026-05-25T08:00:00.000Z",
        token_count: 250,
        body: "# Custom body\n",
      }),
    ];

    const reconciled = reconcileProjectionMetadata(input);
    const metadata = reconciled[0]?.metadata;

    assert.equal(metadata?.project_ref, "repo-a");
    assert.equal(metadata?.source_revision, "rev-abc");
    assert.equal(metadata?.generated_at, "2026-05-25T08:00:00.000Z");
    assert.equal(metadata?.budget.token_count, 250);
    assert.equal(reconciled[0]?.body, "# Custom body\n");
  });

  it("throws when combined_count exceeds hard cap", () => {
    const hardCap = DEFAULT_COMBINED_TOKEN_BUDGET * PROJECTION_BUDGET_HARD_FAIL_MULTIPLIER;

    assert.throws(
      () => reconcileProjectionMetadata([doc("global_projection", hardCap + 1)]),
      (error: unknown) => {
        assert.ok(error instanceof ProjectionMetadataReconcileError);
        assert.match(error.message, /hard cap/);
        return true;
      }
    );
  });

  it("returns schema-valid documents for each kind", () => {
    const input = PROJECTION_FILE_KINDS.map((kind) => doc(kind, 100));
    const reconciled = reconcileProjectionMetadata(input);

    assert.equal(reconciled.length, PROJECTION_FILE_KINDS.length);
    assert.ok(reconciled.every((document) => document.metadata.budget.combined_count === 400));
  });
});
