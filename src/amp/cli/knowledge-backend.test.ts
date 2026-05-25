import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV } from "../gbrain/live-policy.js";
import {
  LOCAL_PROJECTION_KNOWLEDGE_UNAVAILABLE,
} from "../projection/messages.js";
import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import {
  AMP_KNOWLEDGE_BACKEND_ENV,
  createKnowledgeBackend,
  createReadKnowledgeBackend,
  createWriteKnowledgeBackend,
  resolveKnowledgeBackend,
  resolveProjectionKnowledgeStore,
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
      assert.equal(result.error, LOCAL_PROJECTION_KNOWLEDGE_UNAVAILABLE);
    }
  });

  it("rejects fake-gbrain backend for projection source", () => {
    const result = resolveProjectionKnowledgeStore({
      env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "fake-gbrain" },
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, LOCAL_PROJECTION_KNOWLEDGE_UNAVAILABLE);
    }
  });
});
