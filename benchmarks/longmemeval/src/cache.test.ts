import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoCache } from "./cache.js";

test("cache: hit/miss accounting", () => {
  const c = new MemoCache<number>();
  assert.equal(c.get("a"), undefined);
  assert.equal(c.stats().misses, 1);
  c.set("a", 1);
  assert.equal(c.get("a"), 1);
  assert.equal(c.stats().hits, 1);
  assert.equal(c.stats().size, 1);
  c.clear();
  assert.deepEqual(c.stats(), { hits: 0, misses: 0, size: 0 });
});

test("cache: has() does not count as hit/miss", () => {
  const c = new MemoCache<number>();
  c.set("a", 1);
  assert.ok(c.has("a"));
  assert.equal(c.stats().hits, 0);
});
