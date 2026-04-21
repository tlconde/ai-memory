import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkQuestion } from "./chunker.js";
import type { LMEQuestion } from "./types.js";

const fixture: LMEQuestion = {
  question_id: "q1",
  question_type: "single-session-user",
  question: "what color?",
  answer: "blue",
  question_date: "2024-01-10",
  haystack_session_ids: ["s1", "s2"],
  haystack_dates: ["2024-01-01", "2024-01-02"],
  haystack_sessions: [
    [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "" }, // empty — should be skipped
    ],
    [
      { role: "user", content: "my car is blue" },
      { role: "assistant", content: "noted" },
      { role: "user", content: "thanks" },
    ],
  ],
  answer_session_ids: ["s2"],
};

test("chunker: turn granularity emits one chunk per non-empty turn", () => {
  const chunks = chunkQuestion(fixture, { granularity: "turn" });
  // 2 non-empty in s0, 3 in s1 => 5
  assert.equal(chunks.length, 5);
  assert.equal(chunks[0].id, "q1::s0::t0");
  assert.equal(chunks[0].file, "q1::s0");
  assert.equal(chunks[0].text, "[2024-01-01] user: hi");
  assert.equal(chunks[1].id, "q1::s0::t1");
  assert.equal(chunks[1].text, "[2024-01-01] assistant: hello");
  // turn index 2 skipped (empty content) -> next index is t0 of s1
  assert.equal(chunks[2].id, "q1::s1::t0");
  assert.equal(chunks[2].file, "q1::s1");
  assert.equal(chunks[2].text, "[2024-01-02] user: my car is blue");
  // every chunk has content="" per contract
  for (const c of chunks) assert.equal(c.content, "");
});

test("chunker: session granularity emits one chunk per session", () => {
  const chunks = chunkQuestion(fixture, { granularity: "session" });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].id, "q1::s0");
  assert.equal(chunks[0].file, "q1::s0");
  assert.equal(chunks[0].text, "[2024-01-01]\nuser: hi\nassistant: hello");
  assert.equal(chunks[1].id, "q1::s1");
  assert.equal(
    chunks[1].text,
    "[2024-01-02]\nuser: my car is blue\nassistant: noted\nuser: thanks"
  );
});

test("chunker: session granularity skips all-empty sessions", () => {
  const q: LMEQuestion = {
    ...fixture,
    haystack_sessions: [[{ role: "user", content: "" }]],
    haystack_session_ids: ["s1"],
    haystack_dates: ["2024-01-01"],
  };
  const chunks = chunkQuestion(q, { granularity: "session" });
  assert.equal(chunks.length, 0);
});
