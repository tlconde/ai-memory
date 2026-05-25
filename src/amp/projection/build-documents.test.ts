import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFrame } from "../core/frame-schema.js";
import { capturePreference } from "../substrate/capture-preference.js";
import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { buildProjectionDocuments } from "./build-documents.js";
import { estimateProjectionTextTokens } from "./content.js";

describe("buildProjectionDocuments", () => {
  it("routes project-scoped knowledge frames to project projection", () => {
    const documents = buildProjectionDocuments({
      frames: [
        createFrame({
          id: "project-pref",
          kind: "semantic",
          content: "Use conventional commits in this repo.",
          source: { surface: "cursor" },
          created_at: "2026-05-25T00:00:00.000Z",
          scope: { kind: "project", project_ref: "demo-app" },
          curation_mode: "personal",
        }),
      ],
      runtimeItems: [],
      projectRef: "demo-app",
      generatedAt: "2026-05-25T12:00:00.000Z",
      revisionPrefix: "local",
    });

    const projectProjection = documents.find((doc) => doc.metadata.kind === "project_projection");
    assert.match(projectProjection?.body ?? "", /Use conventional commits in this repo\./);
    assert.equal(
      projectProjection?.metadata.budget.token_count,
      estimateProjectionTextTokens("Use conventional commits in this repo.")
    );
  });

  it("routes user and universal frames to global projection", () => {
    const documents = buildProjectionDocuments({
      frames: [
        createFrame({
          id: "global-pref",
          kind: "semantic",
          content: "Prefer explicit return types globally.",
          source: { surface: "cursor" },
          created_at: "2026-05-25T00:00:00.000Z",
          scope: { kind: "user" },
          curation_mode: "personal",
        }),
        createFrame({
          id: "universal-pref",
          kind: "semantic",
          content: "Universal durable preference.",
          source: { surface: "cursor" },
          created_at: "2026-05-25T00:00:00.000Z",
          scope: { kind: "universal" },
          curation_mode: "personal",
        }),
      ],
      runtimeItems: [],
      projectRef: "demo-app",
      generatedAt: "2026-05-25T12:00:00.000Z",
      revisionPrefix: "local",
    });

    const globalProjection = documents.find((doc) => doc.metadata.kind === "global_projection");
    assert.match(globalProjection?.body ?? "", /Prefer explicit return types globally\./);
    assert.match(globalProjection?.body ?? "", /Universal durable preference\./);
  });

  it("excludes mismatched project frames from project sections", () => {
    const documents = buildProjectionDocuments({
      frames: [
        createFrame({
          id: "wrong-project-frame",
          kind: "semantic",
          content: "Wrong project frame.",
          source: { surface: "cursor" },
          created_at: "2026-05-25T00:00:00.000Z",
          scope: { kind: "project", project_ref: "other-app" },
          curation_mode: "personal",
        }),
      ],
      runtimeItems: [],
      projectRef: "demo-app",
      generatedAt: "2026-05-25T12:00:00.000Z",
      revisionPrefix: "local",
    });

    const projectProjection = documents.find((doc) => doc.metadata.kind === "project_projection");
    assert.doesNotMatch(projectProjection?.body ?? "", /Wrong project frame\./);
  });

  it("routes runtime queue items to scoped runtime sections", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-build-documents-runtime-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });

    try {
      capturePreference(runtime, {
        content: "Queued project runtime note.",
        scope: "project",
        projectRef: "demo-app",
      });
      capturePreference(runtime, {
        content: "Queued global runtime note.",
        scope: "user",
      });

      const documents = buildProjectionDocuments({
        frames: [],
        runtimeItems: runtime.queueList(),
        projectRef: "demo-app",
        generatedAt: "2026-05-25T12:00:00.000Z",
        revisionPrefix: "local",
      });

      const globalRuntime = documents.find((doc) => doc.metadata.kind === "global_runtime");
      const projectRuntime = documents.find((doc) => doc.metadata.kind === "project_runtime");

      assert.match(globalRuntime?.body ?? "", /Queued global runtime note\./);
      assert.match(projectRuntime?.body ?? "", /Queued project runtime note\./);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("produces valid documents from empty stores", () => {
    const documents = buildProjectionDocuments({
      frames: [],
      runtimeItems: [],
      projectRef: "empty-app",
      generatedAt: "2026-05-25T12:00:00.000Z",
      revisionPrefix: "local",
    });

    assert.equal(documents.length, 4);
    for (const document of documents) {
      assert.match(document.body, /\S/);
      assert.equal(document.metadata.budget.token_count, 0);
      assert.equal(document.metadata.budget.status, "ok");
      assert.equal(document.metadata.source_revision, "rev-local-empty");
    }
  });

  it("uses stable revision prefixes per source kind", () => {
    const frame = createFrame({
      id: "rev-frame",
      kind: "semantic",
      content: "Revision probe.",
      source: { surface: "cursor" },
      created_at: "2026-05-25T00:00:00.000Z",
      scope: { kind: "user" },
      curation_mode: "personal",
    });

    const localDocs = buildProjectionDocuments({
      frames: [frame],
      runtimeItems: [],
      projectRef: "demo-app",
      generatedAt: "2026-05-25T12:00:00.000Z",
      revisionPrefix: "local",
    });
    const gbrainDocs = buildProjectionDocuments({
      frames: [frame],
      runtimeItems: [],
      projectRef: "demo-app",
      generatedAt: "2026-05-25T12:00:00.000Z",
      revisionPrefix: "gbrain",
    });

    const localGlobal = localDocs.find((doc) => doc.metadata.kind === "global_projection");
    const gbrainGlobal = gbrainDocs.find((doc) => doc.metadata.kind === "global_projection");

    assert.equal(localGlobal?.metadata.source_revision, "rev-local-rev-frame");
    assert.equal(gbrainGlobal?.metadata.source_revision, "rev-gbrain-rev-frame");
  });
});
