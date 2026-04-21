import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { appendJsonl, parseRow, readJsonl, stringifyRow, writeJsonl } from "./jsonl.js";

test("jsonl: round-trip preserves embedded newlines via JSON escaping", () => {
  const row = { question_id: "q1", hypothesis: "line1\nline2\n\"quoted\"" };
  const line = stringifyRow(row);
  assert.ok(!line.includes("\n"), "serialised line must not contain raw newlines");
  const back = parseRow<typeof row>(line);
  assert.deepEqual(back, row);
});

test("jsonl: write + read a file with multiple rows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lme-jsonl-"));
  try {
    const path = join(dir, "x.jsonl");
    const rows = [
      { question_id: "a", hypothesis: "one" },
      { question_id: "b", hypothesis: "two\nlines" },
      { question_id: "c", hypothesis: "three" },
    ];
    await writeJsonl(path, rows);
    const read = await readJsonl<(typeof rows)[number]>(path);
    assert.deepEqual(read, rows);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("jsonl: append builds a valid file incrementally", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lme-jsonl-"));
  try {
    const path = join(dir, "x.jsonl");
    await writeJsonl(path, []);
    await appendJsonl(path, { question_id: "a", hypothesis: "one" });
    await appendJsonl(path, { question_id: "b", hypothesis: "two" });
    const rows = await readJsonl<{ question_id: string; hypothesis: string }>(path);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].question_id, "b");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
