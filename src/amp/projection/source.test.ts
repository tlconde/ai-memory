import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PROJECTION_FILE_KINDS,
  createProjectionDocument,
} from "./index.js";
import {
  PlaceholderProjectionSource,
  placeholderProjectionSource,
} from "./source.js";

describe("PlaceholderProjectionSource", () => {
  it("exposes placeholder sourceKind and refuses apply", () => {
    const source = new PlaceholderProjectionSource();
    assert.equal(source.sourceKind, "placeholder");
    assert.equal(source.supportsApply, false);
  });

  it("loads all four projection kinds via createProjectionDocument", () => {
    const documents = new PlaceholderProjectionSource({
      projectRef: "my-app",
    }).loadProjectionDocuments();

    assert.equal(documents.length, PROJECTION_FILE_KINDS.length);
    const kinds = documents.map((document) => document.metadata.kind);
    assert.deepEqual(kinds, [...PROJECTION_FILE_KINDS]);

    for (const document of documents) {
      assert.match(document.body, /\S/);
      assert.equal(document.metadata.budget.token_count, 0);
    }

    const projectDocs = documents.filter((document) => document.metadata.scope === "project");
    assert.equal(projectDocs.length, 2);
    assert.ok(projectDocs.every((document) => document.metadata.project_ref === "my-app"));
  });

  it("accepts projectRef override per load call", () => {
    const source = new PlaceholderProjectionSource({ projectRef: "default-ref" });
    const documents = source.loadProjectionDocuments({ projectRef: "override-ref" });

    const projectDocs = documents.filter((document) => document.metadata.scope === "project");
    assert.ok(projectDocs.every((document) => document.metadata.project_ref === "override-ref"));
  });

  it("exports a shared placeholderProjectionSource singleton", () => {
    const documents = placeholderProjectionSource.loadProjectionDocuments();
    assert.equal(documents.length, PROJECTION_FILE_KINDS.length);
    assert.equal(placeholderProjectionSource.sourceKind, "placeholder");
    assert.equal(placeholderProjectionSource.supportsApply, false);
  });
});

describe("ProjectionSource contract", () => {
  it("allows non-placeholder sourceKind values with apply support", () => {
    const source = {
      sourceKind: "in-memory",
      supportsApply: true,
      loadProjectionDocuments: () => [createProjectionDocument({ kind: "global_projection" })],
    };

    assert.equal(source.sourceKind, "in-memory");
    assert.equal(source.supportsApply, true);
    assert.equal(source.loadProjectionDocuments().length, 1);
  });
});
