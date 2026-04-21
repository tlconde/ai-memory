import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, promptTemplateSha256, read, type GenaiLike } from "./reader.js";

test("reader: buildPrompt substitutes question/date/excerpts", () => {
  const p = buildPrompt({
    question: "What is X?",
    question_date: "2024-01-10",
    chunks: [
      {
        chunk: { id: "a", file: "f", text: "[2024-01-01] user: X is blue", content: "" },
        rrfScore: 0.1,
      },
    ],
  });
  assert.match(p, /What is X\?/);
  assert.match(p, /2024-01-10/);
  assert.match(p, /\[2024-01-01\] user: X is blue/);
});

test("reader: buildPrompt handles empty chunks gracefully", () => {
  const p = buildPrompt({
    question: "Q",
    question_date: "2024-01-10",
    chunks: [],
  });
  assert.match(p, /\(no excerpts retrieved\)/);
});

test("reader: promptTemplateSha256 is stable hex", () => {
  const h = promptTemplateSha256();
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, promptTemplateSha256());
});

test("reader: retries transient 503 then succeeds", async () => {
  let attempts = 0;
  const client: GenaiLike = {
    models: {
      generateContent: async () => {
        attempts++;
        if (attempts < 2) {
          const err = new Error("503 service unavailable") as Error & { status: number };
          err.status = 503;
          throw err;
        }
        return {
          text: "blue",
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 },
        };
      },
    },
  };
  const sleeps: number[] = [];
  const res = await read(
    { question: "q", question_date: "d", chunks: [] },
    {
      model: "test",
      apiKey: "unused",
      client,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    }
  );
  assert.equal(res.hypothesis, "blue");
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [1000]);
  assert.equal(res.usage.inputTokens, 10);
});

test("reader: non-transient error is not retried", async () => {
  let attempts = 0;
  const client: GenaiLike = {
    models: {
      generateContent: async () => {
        attempts++;
        throw new Error("400 bad request");
      },
    },
  };
  await assert.rejects(
    () =>
      read(
        { question: "q", question_date: "d", chunks: [] },
        { model: "test", apiKey: "unused", client, sleep: async () => {} }
      ),
    /400 bad request/
  );
  assert.equal(attempts, 1);
});
