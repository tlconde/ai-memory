import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { FakeGbrainMcpTransport } from "../adapters/ssa/gbrain/fake-transport.js";
import { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";
import { AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV } from "../gbrain/live-policy.js";
import {
  GBRAIN_PROJECTION_IN_MEMORY_BACKEND,
  LOCAL_PROJECTION_KNOWLEDGE_UNAVAILABLE,
} from "../projection/messages.js";
import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import {
  AMP_KNOWLEDGE_BACKEND_ENV,
  createKnowledgeBackend,
  createReadKnowledgeBackend,
  createWriteKnowledgeBackend,
  resolveKnowledgeBackend,
  resolveProjectionGbrainAdapter,
  resolveProjectionKnowledgeStore,
} from "./knowledge-backend.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GBRAIN_SPEC = join(REPO_ROOT, "ssa-files/gbrain.yaml");

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

describe("resolveProjectionGbrainAdapter", () => {
  it("returns injected adapter without live transport", () => {
    const fake = new FakeGbrainMcpTransport();
    const adapter = new GbrainKnowledgeAdapter({ transport: fake, ssaSpecPath: GBRAIN_SPEC });
    const result = resolveProjectionGbrainAdapter({ gbrainAdapter: adapter });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.adapter, adapter);
      assert.equal(result.liveGbrain, false);
    }
  });

  it("creates fake-gbrain adapter when env requests fake-gbrain", () => {
    const result = resolveProjectionGbrainAdapter({
      env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "fake-gbrain" },
      ampRepoRoot: REPO_ROOT,
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.liveGbrain, false);
    }
  });

  it("rejects in-memory backend for gbrain projection source", () => {
    const result = resolveProjectionGbrainAdapter({
      env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "in-memory" },
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, GBRAIN_PROJECTION_IN_MEMORY_BACKEND);
    }
  });

  it("does not require live gbrain write confirmation for read-only projection", () => {
    const result = resolveProjectionGbrainAdapter({
      env: { [AMP_KNOWLEDGE_BACKEND_ENV]: "fake-gbrain" },
      ampRepoRoot: REPO_ROOT,
    });

    assert.equal(result.ok, true);
  });
});
