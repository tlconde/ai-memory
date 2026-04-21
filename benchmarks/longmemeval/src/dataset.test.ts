import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { loadDataset, sha256Hex } from "./dataset.js";
import type { LMEQuestion } from "./types.js";

function synthQuestions(): LMEQuestion[] {
  return [
    {
      question_id: "qA",
      question_type: "single-session-user",
      question: "?",
      answer: "a",
      question_date: "2024-01-01",
      haystack_session_ids: ["s0"],
      haystack_dates: ["2024-01-01"],
      haystack_sessions: [[{ role: "user", content: "hi" }]],
      answer_session_ids: ["s0"],
    },
  ];
}

test("dataset: loads synthetic fixture with matching hash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lme-ds-"));
  try {
    const data = synthQuestions();
    const body = JSON.stringify(data);
    const hash = sha256Hex(Buffer.from(body, "utf-8"));
    const fname = "fixture.json";
    await writeFile(join(dir, fname), body, "utf-8");

    const loaded = await loadDataset("oracle", {
      dataDir: dir,
      file: fname,
      expectedSha256: hash,
    });
    assert.equal(loaded.sha256, hash);
    assert.equal(loaded.questions.length, 1);
    assert.equal(loaded.questions[0].question_id, "qA");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dataset: throws on hash mismatch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lme-ds-"));
  try {
    await writeFile(join(dir, "fixture.json"), "[]", "utf-8");
    await assert.rejects(
      () =>
        loadDataset("oracle", {
          dataDir: dir,
          file: "fixture.json",
          expectedSha256: "deadbeef".repeat(8),
        }),
      /SHA256 mismatch/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dataset: throws when LME_DATA_DIR unset and no override", async () => {
  const prev = process.env.LME_DATA_DIR;
  delete process.env.LME_DATA_DIR;
  try {
    await assert.rejects(() => loadDataset("oracle"), /LME_DATA_DIR is required/);
  } finally {
    if (prev !== undefined) process.env.LME_DATA_DIR = prev;
  }
});
