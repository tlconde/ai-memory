import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Chunk, RankedChunk } from "../../../src/hybrid-search/index.js";
import { Retriever, type RankFn } from "./retriever.js";
import { runAll } from "./runner.js";
import type { LMEQuestion } from "./types.js";

function q(id: string): LMEQuestion {
  return {
    question_id: id,
    question_type: "single-session-user",
    question: "what?",
    answer: "a",
    question_date: "2024-01-01",
    haystack_session_ids: ["s0"],
    haystack_dates: ["2024-01-01"],
    haystack_sessions: [[{ role: "user", content: "hello world" }]],
    answer_session_ids: ["s0"],
  };
}

test("runner: processes all questions concurrently with mocked reader", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lme-run-"));
  try {
    const hypPath = join(dir, "h.jsonl");
    const errPath = join(dir, "errors.log");
    const fakeRank: RankFn = async (chunks: Chunk[]) => {
      const results: RankedChunk[] = chunks.map((c, i) => ({
        chunk: c,
        rrfScore: 1 / (i + 1),
      }));
      return { results };
    };
    const retriever = new Retriever(fakeRank);
    const questions = [q("q1"), q("q2"), q("q3"), q("q4"), q("q5")];
    const summary = await runAll(questions, {
      mode: "hybrid",
      granularity: "turn",
      topK: 3,
      concurrency: 2,
      readerModel: "fake",
      geminiApiKey: "unused",
      hypothesesPath: hypPath,
      errorsPath: errPath,
      retriever,
      readFn: async (qu) => ({
        hypothesis: `answer-${qu.question_id}`,
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
      onProgress: () => {},
    });
    assert.equal(summary.total, 5);
    assert.equal(summary.errors, 0);
    const lines = (await readFile(hypPath, "utf-8")).trim().split("\n");
    assert.equal(lines.length, 5);
    const ids = lines.map((l) => JSON.parse(l).question_id).sort();
    assert.deepEqual(ids, ["q1", "q2", "q3", "q4", "q5"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runner: captures per-question error as [ERROR] row, continues", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lme-run-err-"));
  try {
    const hypPath = join(dir, "h.jsonl");
    const errPath = join(dir, "errors.log");
    const fakeRank: RankFn = async (chunks: Chunk[]) => ({
      results: chunks.map((c) => ({ chunk: c, rrfScore: 1 })),
    });
    const retriever = new Retriever(fakeRank);
    const questions = [q("ok1"), q("boom"), q("ok2")];
    const summary = await runAll(questions, {
      mode: "hybrid",
      granularity: "turn",
      topK: 3,
      concurrency: 1,
      readerModel: "fake",
      geminiApiKey: "unused",
      hypothesesPath: hypPath,
      errorsPath: errPath,
      retriever,
      readFn: async (qu) => {
        if (qu.question_id === "boom") throw new Error("kaboom");
        return {
          hypothesis: "ok",
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
      onProgress: () => {},
    });
    assert.equal(summary.errors, 1);
    const rows = (await readFile(hypPath, "utf-8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { question_id: string; hypothesis: string; error?: boolean });
    const boom = rows.find((r) => r.question_id === "boom");
    assert.ok(boom, "boom row present");
    assert.ok(boom?.error);
    assert.match(boom!.hypothesis, /^\[ERROR\] kaboom/);
    const log = await readFile(errPath, "utf-8");
    assert.match(log, /boom/);
    assert.match(log, /kaboom/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
