import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AMP_KNOWLEDGE_BACKEND_ENV,
  createKnowledgeBackend,
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

  it("uses live gbrain for the gbrain backend", () => {
    const handle = createKnowledgeBackend({ backend: "gbrain" });
    assert.equal(handle.liveGbrain, true);
    assert.ok(handle.gbrain);
  });

  it("keeps fake-gbrain explicitly test-only and non-live", () => {
    const handle = createKnowledgeBackend({ backend: "fake-gbrain" });
    assert.equal(handle.liveGbrain, false);
    assert.ok(handle.gbrain);
  });
});
