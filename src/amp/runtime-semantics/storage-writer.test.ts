import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProjectionRenderSource } from "../cli/projection-source.js";
import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { AMP_KNOWLEDGE_BACKEND_ENV } from "../cli/knowledge-backend.js";
import { capturePreference } from "../substrate/capture-preference.js";
import { RuntimeStore } from "../substrate/storage/runtime-store.js";
import {
  materializeRuntimeProjectionFromSource,
  type RuntimeSemanticEntityRecord,
} from "./projection-source.js";
import {
  RuntimeSemanticStorageEntitySource,
  RuntimeStoreSemanticEntityReader,
} from "./storage-source.js";
import { RuntimeStoreSemanticEntityWriter, writeRuntimeSemanticEntity } from "./storage-writer.js";
import {
  ACTIVE_PREFERENCE,
  FIXTURE_PROJECT_REF,
  OPEN_DECISION,
  REJECTED_SIGNAL,
} from "./runtime-semantics.test-fixture.js";

describe("RuntimeStoreSemanticEntityWriter", () => {
  it("rejects unknown kinds before storage", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-semantic-writer-unknown-kind-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    try {
      const result = writeRuntimeSemanticEntity(runtime, {
        id: "bad-kind",
        kind: "not-a-runtime-kind" as RuntimeSemanticEntityRecord["kind"],
        scope: "user",
        payload: {},
      });

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "unknown_kind");
      }
      assert.deepEqual(runtime.semanticEntityList(), []);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects record/payload scope mismatch before storage", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-semantic-writer-scope-mismatch-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    try {
      const result = writeRuntimeSemanticEntity(
        runtime,
        {
          id: "pref-scope-mismatch",
          kind: "runtime-preference-candidate",
          scope: "user",
          payload: {
            ...ACTIVE_PREFERENCE,
            id: "pref-scope-mismatch",
            scope: "project",
            project_ref: FIXTURE_PROJECT_REF,
          },
        }
      );

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "record_payload_scope_mismatch");
      }
      assert.deepEqual(runtime.semanticEntityList(), []);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects invalid payloads before storage", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-semantic-writer-invalid-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    try {
      const result = writeRuntimeSemanticEntity(
        runtime,
        {
          id: "dec-bad",
          kind: "unresolved-decision",
          scope: "project",
          project_ref: FIXTURE_PROJECT_REF,
          payload: { id: "dec-bad" },
        }
      );

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "invalid_input");
      }
      assert.deepEqual(runtime.semanticEntityList(), []);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("requires project_ref for project-scoped records", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-semantic-writer-project-ref-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    try {
      const result = writeRuntimeSemanticEntity(
        runtime,
        {
          id: "dec-missing-ref",
          kind: "unresolved-decision",
          scope: "project",
          payload: OPEN_DECISION,
        }
      );

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, "missing_record_project_ref");
      }
      assert.deepEqual(runtime.semanticEntityList(), []);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("persists non-projectable valid entities that skip safely at materialization", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-semantic-writer-non-projectable-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    try {
      const writeResult = writeRuntimeSemanticEntity(
        runtime,
        {
          id: "rej-1",
          kind: "rejected-signal-log",
          scope: "project",
          project_ref: FIXTURE_PROJECT_REF,
          payload: REJECTED_SIGNAL,
        }
      );
      assert.equal(writeResult.ok, true);

      assert.equal(runtime.semanticEntityList().length, 1);

      const source = new RuntimeSemanticStorageEntitySource(
        new RuntimeStoreSemanticEntityReader(runtime)
      );
      const materialized = materializeRuntimeProjectionFromSource(source, {
        projectRef: FIXTURE_PROJECT_REF,
      });

      assert.equal(materialized.items.length, 0);
      assert.equal(materialized.skipped.length, 1);
      assert.equal(materialized.skipped[0]?.reason, "not_projectable");
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails predictably on duplicate IDs without corrupting insertion order", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-semantic-writer-duplicate-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    const writer = new RuntimeStoreSemanticEntityWriter(runtime);
    try {
      const first = writer.write(
        {
          id: "pref-a",
          kind: "runtime-preference-candidate",
          scope: "user",
          payload: { ...ACTIVE_PREFERENCE, id: "pref-a", statement: "First" },
        }
      );
      const second = writer.write(
        {
          id: "pref-b",
          kind: "runtime-preference-candidate",
          scope: "user",
          payload: { ...ACTIVE_PREFERENCE, id: "pref-b", statement: "Second" },
        }
      );
      const duplicate = writer.write(
        {
          id: "pref-a",
          kind: "runtime-preference-candidate",
          scope: "user",
          payload: { ...ACTIVE_PREFERENCE, id: "pref-a", statement: "Duplicate attempt" },
        }
      );

      assert.equal(first.ok, true);
      assert.equal(second.ok, true);
      assert.equal(duplicate.ok, false);
      if (!duplicate.ok) {
        assert.equal(duplicate.reason, "duplicate_id");
      }

      assert.deepEqual(
        runtime.semanticEntityList().map((row) => row.id),
        ["pref-a", "pref-b"]
      );
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("materializes user and project entities through the default local projection factory path", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-runtime-semantic-writer-factory-"));
    const runtime = new RuntimeStore({ dbPath: join(tempDir, "runtime.db") });
    const knowledge = new InMemoryKnowledgeStore();
    try {
      assert.equal(
        writeRuntimeSemanticEntity(
          runtime,
          {
            id: "pref-1",
            kind: "runtime-preference-candidate",
            scope: "user",
            payload: ACTIVE_PREFERENCE,
          }
        ).ok,
        true
      );
      assert.equal(
        writeRuntimeSemanticEntity(
          runtime,
          {
            id: "dec-1",
            kind: "unresolved-decision",
            scope: "project",
            project_ref: FIXTURE_PROJECT_REF,
            payload: OPEN_DECISION,
          }
        ).ok,
        true
      );
      capturePreference(runtime, {
        content: "Queue row stays separate from typed table.",
        scope: "project",
        projectRef: FIXTURE_PROJECT_REF,
      });

      const resolved = createProjectionRenderSource({
        sourceKind: "local",
        projectRef: FIXTURE_PROJECT_REF,
        runtimeDbPath: join(tempDir, "runtime.db"),
        knowledgeStore: knowledge,
        env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "in-memory" },
        deps: { openRuntimeStore: () => runtime },
      });

      assert.ok(!("error" in resolved));
      const documents = resolved.source.loadProjectionDocuments({ projectRef: FIXTURE_PROJECT_REF });
      const globalRuntime = documents.find((doc) => doc.metadata.kind === "global_runtime");
      const projectRuntime = documents.find((doc) => doc.metadata.kind === "project_runtime");

      assert.match(globalRuntime?.body ?? "", /Keep responses short today/);
      assert.match(projectRuntime?.body ?? "", /Which storage backend\?/);
      assert.match(projectRuntime?.body ?? "", /Queue row stays separate from typed table\./);
    } finally {
      runtime.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
