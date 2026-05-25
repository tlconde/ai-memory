import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { createFrame } from "../core/frame-schema.js";
import { formatAmpRetrieveMessages, runAmpRetrieve } from "./retrieve.js";

describe("runAmpRetrieve", () => {
  it("reads preferences from injected in-memory store", async () => {
    const knowledge = new InMemoryKnowledgeStore();
    knowledge.write([
      createFrame({
        id: "frame-cli-1",
        kind: "semantic",
        content: "Prefer explicit verification commands.",
        source: { surface: "cursor", harness: "cursor" },
        created_at: "2026-05-24T12:00:00.000Z",
        scope: { kind: "project", project_ref: "ai-memory" },
        curation_mode: "personal",
      }),
    ]);

    const result = await runAmpRetrieve({
      projectRoot: process.cwd(),
      knowledge: "in-memory",
      inMemoryStore: knowledge,
      scope: "project",
      projectRef: "ai-memory",
      query: "verification",
    });

    assert.equal(result.preferences.length, 1);
    assert.equal(result.knowledgeBackend, "in-memory");
    assert.equal(result.preferences[0]?.frame.content, "Prefer explicit verification commands.");
  });

  it("formatAmpRetrieveMessages renders matches and empty state", () => {
    const withMatches = formatAmpRetrieveMessages({
      projectRoot: "/tmp/project",
      knowledgeBackend: "in-memory",
      scope: "project",
      projectRef: "ai-memory",
      preferences: [
        {
          frame: createFrame({
            id: "frame-1",
            kind: "semantic",
            content: "Hello world.",
            source: { surface: "cursor", harness: "cursor" },
            created_at: "2026-05-24T12:00:00.000Z",
            scope: { kind: "project", project_ref: "ai-memory" },
            curation_mode: "personal",
          }),
        },
      ],
    });

    assert.match(withMatches.join("\n"), /Hello world/);

    const empty = formatAmpRetrieveMessages({
      projectRoot: "/tmp/project",
      knowledgeBackend: "gbrain",
      scope: "user",
      preferences: [],
    });

    assert.match(empty.join("\n"), /no matches/i);
  });
});
