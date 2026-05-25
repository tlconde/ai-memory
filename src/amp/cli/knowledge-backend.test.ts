import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV } from "../gbrain/live-policy.js";
import {
  AMP_KNOWLEDGE_BACKEND_ENV,
  createKnowledgeBackend,
  createReadKnowledgeBackend,
  createWriteKnowledgeBackend,
  resolveKnowledgeBackend,
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
