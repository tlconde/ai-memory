import { test } from "node:test";
import assert from "node:assert/strict";
import type { Chunk, RankedChunk } from "../../../src/hybrid-search/index.js";
import { Retriever, type RankFn } from "./retriever.js";

test("retriever: second call with same cacheKey hits cache (no extra rank invocation)", async () => {
  let calls = 0;
  const fakeRank: RankFn = async (chunks) => {
    calls++;
    const ranked: RankedChunk[] = chunks.map((c, i) => ({
      chunk: c,
      rrfScore: 1 / (i + 1),
    }));
    return { results: ranked };
  };
  const r = new Retriever(fakeRank);
  const chunks: Chunk[] = [
    { id: "a", file: "f", text: "hello world", content: "" },
    { id: "b", file: "f", text: "goodbye world", content: "" },
  ];

  const r1 = await r.retrieve(chunks, "hello", {
    mode: "hybrid",
    topK: 2,
    cacheKey: "key-1",
  });
  const r2 = await r.retrieve(chunks, "hello", {
    mode: "hybrid",
    topK: 2,
    cacheKey: "key-1",
  });
  assert.equal(r1, r2, "same reference returned from cache");
  assert.equal(calls, 1, "rank fn must only run once for repeated cacheKey");
  assert.equal(r.rankCalls, 1);
  assert.equal(r.stats().hits, 1);

  // Different cacheKey -> new rank call
  const r3 = await r.retrieve(chunks, "hello", {
    mode: "hybrid",
    topK: 2,
    cacheKey: "key-2",
  });
  assert.ok(r3);
  assert.equal(calls, 2);
});
