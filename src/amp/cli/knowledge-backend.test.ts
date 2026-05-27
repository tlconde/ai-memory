import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV } from "../gbrain/live-policy.js";
import {
  LEGACY_PROJECTION_KNOWLEDGE_BACKEND_UNAVAILABLE,
  LOCAL_PROJECTION_KNOWLEDGE_UNAVAILABLE,
} from "../projection/messages.js";
import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { LocalSqliteKnowledgeStore } from "../adapters/ssa/local-sqlite-knowledge-store.js";
import {
  AMP_KNOWLEDGE_BACKEND_ENV,
  createKnowledgeBackend,
  createReadKnowledgeBackend,
  createWriteKnowledgeBackend,
  resolveKnowledgeBackend,
  resolveLocalKnowledgeDbPath,
  resolveLocalPersistentProjectionKnowledgeStore,
  resolveLocalPersistentRetrieveKnowledgeStore,
  resolveProjectionKnowledgeStore,
  resolveGraduationApplyKnowledgeStore,
  GRADUATION_APPLY_KNOWLEDGE_NOT_PERSISTENT,
  LOCAL_RETRIEVE_KNOWLEDGE_UNAVAILABLE,
} from "./knowledge-backend.js";

describe("resolveKnowledgeBackend", () => {
  it("defaults to gbrain when unset", () => {
    assert.equal(resolveKnowledgeBackend({ env: {} }), "gbrain");
  });

  it("reads AMP_KNOWLEDGE_BACKEND env", () => {
    assert.equal(
      resolveKnowledgeBackend({ env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "in-memory" } }),
      "in-memory"
    );
  });

  it("prefers explicit CLI value over env", () => {
    assert.equal(
      resolveKnowledgeBackend({
        explicit: "fake-gbrain",
        env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "in-memory" },
      }),
      "fake-gbrain"
    );
  });

  it("throws on invalid backend", () => {
    assert.throws(() => resolveKnowledgeBackend({ explicit: "postgres" }), /Invalid knowledge backend/);
  });
});

describe("createKnowledgeBackend", () => {
  it("creates in-memory store by default", () => {
    const handle = createKnowledgeBackend({ backend: "in-memory" });
    assert.equal(handle.backend, "in-memory");
    assert.ok(handle.inMemory);
  });

  it("allows live gbrain reads without write confirmation", () => {
    const handle = createReadKnowledgeBackend({ backend: "gbrain" });
    assert.equal(handle.liveGbrain, true);
    assert.ok(handle.gbrain);
  });

  it("blocks live gbrain writes without confirmation", () => {
    assert.throws(
      () => createWriteKnowledgeBackend({ backend: "gbrain", env: {} }),
      /Live gbrain writes are disabled/
    );
  });

  it("allows live gbrain writes when confirmation env is set", () => {
    const handle = createWriteKnowledgeBackend({
      backend: "gbrain",
      env: { [AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV]: "1" },
    });
    assert.equal(handle.liveGbrain, true);
    assert.ok(handle.gbrain);
  });

  it("keeps fake-gbrain explicitly test-only and non-live", () => {
    const handle = createKnowledgeBackend({ backend: "fake-gbrain" });
    assert.equal(handle.liveGbrain, false);
    assert.ok(handle.gbrain);
  });
});

describe("resolveProjectionKnowledgeStore", () => {
  it("returns injected store without reading env backend", () => {
    const injected = new InMemoryKnowledgeStore();
    const result = resolveProjectionKnowledgeStore({
      knowledgeStore: injected,
      env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "gbrain" },
    });

    assert.equal(result.ok, true);
    assert.equal(result.store, injected);
  });

  it("creates in-memory store when env backend is in-memory", () => {
    const result = resolveProjectionKnowledgeStore({
      env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "in-memory" },
    });

    assert.equal(result.ok, true);
    assert.ok(result.store instanceof InMemoryKnowledgeStore);
  });

  it("rejects gbrain backend without constructing live gbrain", () => {
    const result = resolveProjectionKnowledgeStore({ env: {} });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, LEGACY_PROJECTION_KNOWLEDGE_BACKEND_UNAVAILABLE);
    }
  });

  it("rejects fake-gbrain backend for projection source", () => {
    const result = resolveProjectionKnowledgeStore({
      env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "fake-gbrain" },
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, LEGACY_PROJECTION_KNOWLEDGE_BACKEND_UNAVAILABLE);
    }
  });

  it("legacy resolver error mentions in-memory without claiming local projection requires it", () => {
    const result = resolveProjectionKnowledgeStore({ env: {} });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /AMP_KNOWLEDGE_BACKEND=in-memory/);
      assert.match(result.error, /Legacy projection knowledge resolver/);
      assert.doesNotMatch(result.error, /Set AMP_KNOWLEDGE_BACKEND=in-memory or run/);
    }
  });
});

describe("resolveLocalPersistentProjectionKnowledgeStore", () => {
  it("returns injected store for explicit test/DI boundaries", () => {
    const injected = new InMemoryKnowledgeStore();
    const result = resolveLocalPersistentProjectionKnowledgeStore({ knowledgeStore: injected });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.store, injected);
      result.cleanup();
    }
  });

  it("opens LocalSqliteKnowledgeStore when runtimeDbPath is provided", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-projection-knowledge-resolve-"));
    const runtimeDbPath = join(tempDir, "runtime.db");

    try {
      const result = resolveLocalPersistentProjectionKnowledgeStore({ runtimeDbPath });

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.ok(result.store instanceof LocalSqliteKnowledgeStore);
        result.cleanup();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not consult AMP_KNOWLEDGE_BACKEND when runtimeDbPath is provided", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-projection-knowledge-no-gbrain-"));
    const runtimeDbPath = join(tempDir, "runtime.db");

    try {
      const result = resolveLocalPersistentProjectionKnowledgeStore({
        runtimeDbPath,
      });

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.ok(result.store instanceof LocalSqliteKnowledgeStore);
        result.cleanup();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("closes local SQLite store via cleanup", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-projection-knowledge-cleanup-"));
    const runtimeDbPath = join(tempDir, "runtime.db");

    try {
      const result = resolveLocalPersistentProjectionKnowledgeStore({ runtimeDbPath });
      assert.equal(result.ok, true);
      if (result.ok) {
        result.cleanup();
        const reopened = new LocalSqliteKnowledgeStore({
          dbPath: resolveLocalKnowledgeDbPath(runtimeDbPath),
        });
        try {
          assert.equal(reopened.list().length, 0);
        } finally {
          reopened.close();
        }
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails closed when neither injected store nor runtimeDbPath is provided", () => {
    const result = resolveLocalPersistentProjectionKnowledgeStore();

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, LOCAL_PROJECTION_KNOWLEDGE_UNAVAILABLE);
    }
  });

  it("persistent resolver error does not claim in-memory is required for local projection", () => {
    const result = resolveLocalPersistentProjectionKnowledgeStore();
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /persistent knowledge\.db/);
      assert.doesNotMatch(result.error, /AMP_KNOWLEDGE_BACKEND=in-memory/);
    }
  });
});

describe("resolveLocalPersistentRetrieveKnowledgeStore", () => {
  it("returns injected store for explicit test/DI boundaries", () => {
    const injected = new InMemoryKnowledgeStore();
    const result = resolveLocalPersistentRetrieveKnowledgeStore({ knowledgeStore: injected });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.store, injected);
      result.cleanup();
    }
  });

  it("opens LocalSqliteKnowledgeStore when runtimeDbPath is provided", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-retrieve-knowledge-resolve-"));
    const runtimeDbPath = join(tempDir, "runtime.db");

    try {
      const result = resolveLocalPersistentRetrieveKnowledgeStore({ runtimeDbPath });

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.ok(result.store instanceof LocalSqliteKnowledgeStore);
        result.cleanup();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("closes local SQLite store via cleanup", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-retrieve-knowledge-cleanup-"));
    const runtimeDbPath = join(tempDir, "runtime.db");

    try {
      const result = resolveLocalPersistentRetrieveKnowledgeStore({ runtimeDbPath });
      assert.equal(result.ok, true);
      if (result.ok) {
        result.cleanup();
        const reopened = new LocalSqliteKnowledgeStore({
          dbPath: resolveLocalKnowledgeDbPath(runtimeDbPath),
        });
        try {
          assert.equal(reopened.list().length, 0);
        } finally {
          reopened.close();
        }
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails closed when neither injected store nor runtimeDbPath is provided", () => {
    const result = resolveLocalPersistentRetrieveKnowledgeStore();

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, LOCAL_RETRIEVE_KNOWLEDGE_UNAVAILABLE);
    }
  });
});

describe("resolveGraduationApplyKnowledgeStore", () => {
  it("returns injected store for explicit test/DI boundaries", () => {
    const injected = new InMemoryKnowledgeStore();
    const result = resolveGraduationApplyKnowledgeStore({ knowledgeStore: injected });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.store, injected);
      result.cleanup();
    }
  });

  it("opens LocalSqliteKnowledgeStore when runtimeDbPath is provided", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-graduation-knowledge-resolve-"));
    const runtimeDbPath = join(tempDir, "runtime.db");

    try {
      const result = resolveGraduationApplyKnowledgeStore({ runtimeDbPath });

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.ok(result.store instanceof LocalSqliteKnowledgeStore);
        assert.equal(resolveLocalKnowledgeDbPath(runtimeDbPath), join(tempDir, "knowledge.db"));
        result.cleanup();
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("closes local SQLite store via cleanup", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "amp-graduation-knowledge-cleanup-"));
    const runtimeDbPath = join(tempDir, "runtime.db");

    try {
      const result = resolveGraduationApplyKnowledgeStore({ runtimeDbPath });
      assert.equal(result.ok, true);
      if (result.ok) {
        result.cleanup();
        const reopened = new LocalSqliteKnowledgeStore({
          dbPath: resolveLocalKnowledgeDbPath(runtimeDbPath),
        });
        try {
          assert.equal(reopened.list().length, 0);
        } finally {
          reopened.close();
        }
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails closed when no injected store or runtimeDbPath is provided", () => {
    const result = resolveGraduationApplyKnowledgeStore();

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "knowledge_backend_not_persistent");
      assert.equal(result.error, GRADUATION_APPLY_KNOWLEDGE_NOT_PERSISTENT);
    }
  });
});

describe("resolveLocalKnowledgeDbPath", () => {
  it("returns knowledge.db adjacent to runtime.db", () => {
    assert.equal(
      resolveLocalKnowledgeDbPath("/tmp/project/.amp/runtime/runtime.db"),
      "/tmp/project/.amp/runtime/knowledge.db",
    );
  });
});
