/**
 * Unit tests for the chunk-level retrieval refactor.
 *
 * Runner: `node --import tsx --test` (see package.json `test` script).
 *
 * Semantic-path tests guard on `AI_SEARCH_OFFLINE=1` (or `AI_MODEL_PATH` unset +
 * no network) by skipping at runtime when model load fails, so the keyword path
 * always runs deterministically.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  rankChunks,
  hybridSearch,
  loadChunks,
  type Chunk,
  type RankedChunk,
} from "./index.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function chunk(id: string, file: string, text: string): Chunk {
  return { id, file, text, content: text };
}

async function makeTempAiDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hybrid-search-test-"));
  return dir;
}

/** True when the semantic model can be loaded in this environment. */
let semanticAvailable: boolean | null = null;
async function canRunSemantic(): Promise<boolean> {
  if (semanticAvailable !== null) return semanticAvailable;
  try {
    // Smoke test via rankChunks in semantic mode on a trivial input.
    const res = await rankChunks(
      [chunk("a#0", "a.md", "hello world")],
      "hello",
      { mode: "semantic", topK: 1 }
    );
    semanticAvailable = res.results.length > 0;
  } catch {
    semanticAvailable = false;
  }
  return semanticAvailable;
}

// ─── rankChunks: empty / degenerate inputs ───────────────────────────────────

describe("rankChunks — empty / degenerate inputs", () => {
  it("empty chunks[] returns {results: [], backend: 'keyword'} in keyword mode", async () => {
    const out = await rankChunks([], "anything", { mode: "keyword" });
    assert.deepEqual(out, { results: [], backend: "keyword" });
  });

  it("empty chunks[] returns {results: [], backend: 'keyword'} in semantic mode (no model load)", async () => {
    const out = await rankChunks([], "anything", { mode: "semantic" });
    assert.deepEqual(out, { results: [], backend: "keyword" });
  });

  it("empty chunks[] returns {results: [], backend: 'keyword'} in hybrid mode (no model load)", async () => {
    const out = await rankChunks([], "anything", { mode: "hybrid" });
    assert.deepEqual(out, { results: [], backend: "keyword" });
  });

  it("empty query returns empty results (all modes)", async () => {
    const cs = [chunk("a#0", "a.md", "hello world")];
    for (const mode of ["keyword", "semantic", "hybrid"] as const) {
      const out = await rankChunks(cs, "", { mode });
      assert.deepEqual(out.results, []);
      assert.equal(out.backend, "keyword");
    }
  });

  it("whitespace-only query returns empty results (all modes)", async () => {
    const cs = [chunk("a#0", "a.md", "hello world")];
    for (const mode of ["keyword", "semantic", "hybrid"] as const) {
      const out = await rankChunks(cs, "   \t\n ", { mode });
      assert.deepEqual(out.results, []);
      assert.equal(out.backend, "keyword");
    }
  });
});

// ─── rankChunks: keyword mode ────────────────────────────────────────────────

describe("rankChunks — keyword mode", () => {
  it("returns real TF scores; multiple chunks per file can appear", async () => {
    const cs = [
      chunk("x.md#0", "x.md", "alpha alpha alpha beta"),
      chunk("x.md#1", "x.md", "alpha beta gamma"),
      chunk("y.md#0", "y.md", "gamma delta"),
    ];
    const out = await rankChunks(cs, "alpha", { mode: "keyword", topK: 10 });
    // Two chunks in x.md both match 'alpha'; both must appear (no file dedupe at rankChunks level).
    const files = out.results.map((r) => r.chunk.file);
    assert.equal(files.filter((f) => f === "x.md").length, 2);
    // Scores are real TF counts, not stubs, and vary.
    const scores = out.results.map((r) => r.kwScore);
    assert.ok(scores.every((s) => typeof s === "number" && s > 0));
    assert.ok(new Set(scores).size > 1);
    // Top result has highest TF.
    assert.equal(out.results[0].chunk.id, "x.md#0");
    assert.equal(out.results[0].kwScore, 3);
    assert.equal(out.backend, "keyword");
  });

  it("semRank / semSim undefined on all results", async () => {
    const cs = [chunk("a#0", "a.md", "alpha beta")];
    const out = await rankChunks(cs, "alpha", { mode: "keyword" });
    assert.ok(out.results.length > 0);
    for (const r of out.results) {
      assert.equal(r.semRank, undefined);
      assert.equal(r.semSim, undefined);
      assert.ok(typeof r.kwRank === "number");
      assert.ok(typeof r.kwScore === "number");
    }
  });

  it("topK limits results", async () => {
    const cs = Array.from({ length: 20 }, (_, i) =>
      chunk(`f${i}.md#0`, `f${i}.md`, "alpha ".repeat(i + 1))
    );
    const out = await rankChunks(cs, "alpha", { mode: "keyword", topK: 5 });
    assert.equal(out.results.length, 5);
  });

  it("tie-breaking: equal scores sort by id ascending", async () => {
    const cs = [
      chunk("zzz.md#0", "zzz.md", "alpha"),
      chunk("aaa.md#0", "aaa.md", "alpha"),
      chunk("mmm.md#0", "mmm.md", "alpha"),
    ];
    const out = await rankChunks(cs, "alpha", { mode: "keyword", topK: 10 });
    assert.deepEqual(
      out.results.map((r) => r.chunk.id),
      ["aaa.md#0", "mmm.md#0", "zzz.md#0"]
    );
  });

  it("synthesizes __anon_<i> ids when missing", async () => {
    const cs: Chunk[] = [
      { file: "a.md", text: "alpha", content: "alpha" },
      { file: "b.md", text: "alpha alpha", content: "alpha alpha" },
    ];
    const out = await rankChunks(cs, "alpha", { mode: "keyword", topK: 10 });
    const ids = new Set(out.results.map((r) => r.chunk.id));
    assert.ok(ids.has("__anon_0"));
    assert.ok(ids.has("__anon_1"));
  });

  it("tags filter excludes chunks entirely (no undefined-rank placeholders)", async () => {
    const cs = [
      chunk("a#0", "a.md", "alpha context-x"),
      chunk("b#0", "b.md", "alpha context-y"),
    ];
    const out = await rankChunks(cs, "alpha", {
      mode: "keyword",
      topK: 10,
      tags: ["context-x"],
    });
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0].chunk.file, "a.md");
  });

  it("includeDeprecated=false filters chunks whose first line contains [DEPRECATED]", async () => {
    const cs = [
      chunk("a#0", "a.md", "[DEPRECATED] old alpha info\nmore text"),
      chunk("b#0", "b.md", "current alpha info"),
    ];
    const out = await rankChunks(cs, "alpha", { mode: "keyword", topK: 10 });
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0].chunk.file, "b.md");
  });

  it("includeDeprecated=true keeps [DEPRECATED] chunks", async () => {
    const cs = [
      chunk("a#0", "a.md", "[DEPRECATED] old alpha info"),
      chunk("b#0", "b.md", "current alpha info"),
    ];
    const out = await rankChunks(cs, "alpha", {
      mode: "keyword",
      topK: 10,
      includeDeprecated: true,
    });
    assert.equal(out.results.length, 2);
  });

  it("determinism: two identical calls return bit-identical results", async () => {
    const cs = Array.from({ length: 30 }, (_, i) =>
      chunk(`f${i}.md#0`, `f${i}.md`, `alpha ${"beta ".repeat(i)}gamma`)
    );
    const a = await rankChunks(cs, "alpha beta", { mode: "keyword", topK: 20 });
    const b = await rankChunks(cs, "alpha beta", { mode: "keyword", topK: 20 });
    assert.deepEqual(
      a.results.map((r) => ({ id: r.chunk.id, score: r.kwScore, rank: r.kwRank })),
      b.results.map((r) => ({ id: r.chunk.id, score: r.kwScore, rank: r.kwRank }))
    );
  });
});

// ─── rankChunks: semantic / hybrid modes (model-dependent) ────────────────────

describe("rankChunks — semantic / hybrid modes", () => {
  it("semantic mode: kwRank / kwScore undefined on all results", async (t) => {
    if (!(await canRunSemantic())) return t.skip("semantic model unavailable");
    const cs = [
      chunk("a#0", "a.md", "The quick brown fox jumps over the lazy dog."),
      chunk("b#0", "b.md", "Hybrid search merges keyword and semantic retrievers."),
    ];
    const out = await rankChunks(cs, "vector similarity", { mode: "semantic", topK: 5 });
    assert.ok(out.results.length > 0);
    for (const r of out.results) {
      assert.equal(r.kwRank, undefined);
      assert.equal(r.kwScore, undefined);
      assert.ok(typeof r.semRank === "number");
      assert.ok(typeof r.semSim === "number");
    }
  });

  it("hybrid mode: rrfScore populated; kwRank/semRank present only when retriever included chunk", async (t) => {
    if (!(await canRunSemantic())) return t.skip("semantic model unavailable");
    const cs = [
      // Keyword-match only (query term 'alpha' appears, no semantic relevance claim):
      chunk("kw-only#0", "kw-only.md", "alpha alpha alpha — unrelated filler text"),
      // Neither keyword match nor strong semantic match for 'alpha':
      chunk("neither#0", "neither.md", "completely unrelated sentence about pizza"),
      // Another keyword-matching chunk:
      chunk("kw2#0", "kw2.md", "alpha text"),
    ];
    const out = await rankChunks(cs, "alpha", { mode: "hybrid", topK: 10 });
    assert.ok(out.results.length > 0);
    for (const r of out.results) {
      assert.ok(typeof r.rrfScore === "number" && r.rrfScore > 0);
    }
    // Chunks that matched keyword should have kwRank set.
    const kwOnly = out.results.find((r) => r.chunk.id === "kw-only#0");
    if (kwOnly) {
      assert.ok(typeof kwOnly.kwRank === "number");
      assert.ok(typeof kwOnly.kwScore === "number");
    }
    // 'neither' does not match keyword 'alpha', so kwRank should be undefined if present.
    const neither = out.results.find((r) => r.chunk.id === "neither#0");
    if (neither) {
      assert.equal(neither.kwRank, undefined);
      assert.equal(neither.kwScore, undefined);
      // Semantic retriever ran and included all chunks, so semRank must be a number.
      assert.ok(typeof neither.semRank === "number");
    }
  });

  it("determinism: two identical hybrid calls return equal rrfScores within 1e-6", async (t) => {
    if (!(await canRunSemantic())) return t.skip("semantic model unavailable");
    const cs = Array.from({ length: 10 }, (_, i) =>
      chunk(`f${i}.md#0`, `f${i}.md`, `content number ${i} about alpha beta gamma`)
    );
    const a = await rankChunks(cs, "alpha gamma", { mode: "hybrid", topK: 10 });
    const b = await rankChunks(cs, "alpha gamma", { mode: "hybrid", topK: 10 });
    assert.equal(a.results.length, b.results.length);
    for (let i = 0; i < a.results.length; i++) {
      assert.equal(a.results[i].chunk.id, b.results[i].chunk.id);
      assert.ok(Math.abs(a.results[i].rrfScore - b.results[i].rrfScore) < 1e-6);
      if (a.results[i].semSim !== undefined && b.results[i].semSim !== undefined) {
        assert.ok(Math.abs((a.results[i].semSim as number) - (b.results[i].semSim as number)) < 1e-6);
      }
    }
  });

  it("batching determinism: 70 chunks (crosses 64-batch boundary) produce same sims as a reference run", async (t) => {
    if (!(await canRunSemantic())) return t.skip("semantic model unavailable");
    // Because EMBED_BATCH_SIZE=64 is a module constant and normalize:true guarantees
    // per-vector independence, two calls over a 70-chunk set must agree bit-for-bit
    // (up to floating-point noise).
    const cs = Array.from({ length: 70 }, (_, i) =>
      chunk(`f${i}.md#0`, `f${i}.md`, `chunk ${i} with keywords alpha beta gamma delta`)
    );
    const a = await rankChunks(cs, "alpha", { mode: "semantic", topK: 70 });
    const b = await rankChunks(cs, "alpha", { mode: "semantic", topK: 70 });
    assert.equal(a.results.length, b.results.length);
    for (let i = 0; i < a.results.length; i++) {
      assert.equal(a.results[i].chunk.id, b.results[i].chunk.id);
      const sA = a.results[i].semSim as number;
      const sB = b.results[i].semSim as number;
      assert.ok(Math.abs(sA - sB) < 1e-6, `semSim mismatch at ${i}: ${sA} vs ${sB}`);
    }
  });
});

// ─── hybridSearch: regression / stub-preservation ────────────────────────────

describe("hybridSearch — regression", () => {
  it("keyword mode: results have score > 0 and vary", async () => {
    const dir = await makeTempAiDir();
    try {
      await writeFile(join(dir, "x.md"), "alpha alpha alpha beta\n");
      await writeFile(join(dir, "y.md"), "alpha\n");
      const out = await hybridSearch(dir, "alpha", { mode: "keyword", limit: 10 });
      assert.ok(out.results.length === 2);
      for (const r of out.results) assert.ok(r.score > 0);
      const scores = out.results.map((r) => r.score);
      assert.ok(new Set(scores).size > 1, "expected varying TF scores");
      assert.equal(out.backend, "keyword");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("single file with 3 ## sections returns at most 1 result", async () => {
    const dir = await makeTempAiDir();
    try {
      const body = [
        "# Top",
        "",
        "## Section A",
        "alpha content",
        "",
        "## Section B",
        "alpha content too",
        "",
        "## Section C",
        "alpha more",
      ].join("\n");
      await writeFile(join(dir, "multi.md"), body);
      const out = await hybridSearch(dir, "alpha", { mode: "keyword", limit: 10 });
      const files = out.results.map((r) => r.file);
      assert.equal(files.length, 1);
      assert.equal(files[0], "multi.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("backend field is populated in response", async () => {
    const dir = await makeTempAiDir();
    try {
      await writeFile(join(dir, "x.md"), "alpha beta\n");
      const out = await hybridSearch(dir, "alpha", { mode: "keyword", limit: 10 });
      assert.ok(["native", "wasm", "keyword"].includes(out.backend));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("semantic mode result has score === 1 (stub preserved)", async (t) => {
    if (!(await canRunSemantic())) return t.skip("semantic model unavailable");
    const dir = await makeTempAiDir();
    try {
      await writeFile(join(dir, "x.md"), "vector similarity search is great\n");
      const out = await hybridSearch(dir, "embedding", { mode: "semantic", limit: 5 });
      assert.ok(out.results.length > 0);
      for (const r of out.results) assert.equal(r.score, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("hybrid mode result has score === 1 (stub preserved — critical for governance.ts gating)", async (t) => {
    if (!(await canRunSemantic())) return t.skip("semantic model unavailable");
    const dir = await makeTempAiDir();
    try {
      await writeFile(join(dir, "x.md"), "vector similarity search is great\n");
      const out = await hybridSearch(dir, "embedding", { mode: "hybrid", limit: 5 });
      assert.ok(out.results.length > 0);
      for (const r of out.results) assert.equal(r.score, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("file-level dedupe keeps highest-scoring chunk (excerpt from winning chunk)", async () => {
    const dir = await makeTempAiDir();
    try {
      // Three sections in same file; the MIDDLE section has the most 'alpha' hits.
      // This distinguishes "highest-ranked wins" from "first-by-file-order wins"
      // and from "last-by-file-order wins". Each section has a unique marker.
      const body = [
        "## First",
        "alpha LOSER_FIRST",
        "",
        "## Middle",
        "alpha alpha alpha alpha alpha WINNER_MIDDLE",
        "",
        "## Last",
        "alpha alpha LOSER_LAST",
      ].join("\n");
      await writeFile(join(dir, "f.md"), body);
      const out = await hybridSearch(dir, "alpha", { mode: "keyword", limit: 10 });
      assert.equal(out.results.length, 1);
      assert.ok(
        out.results[0].excerpt.includes("WINNER_MIDDLE"),
        `expected winner's excerpt, got: ${out.results[0].excerpt}`
      );
      assert.ok(!out.results[0].excerpt.includes("LOSER_FIRST"));
      assert.ok(!out.results[0].excerpt.includes("LOSER_LAST"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("file-dedupe fills `limit` even when one file dominates top ranks (regression)", async () => {
    // Regression: the previous `topK = min(max(limit*8, limit), chunks.length)` heuristic
    // would underfill `limit` when a single file contributed many high-scoring chunks,
    // starving the dedupe of distinct files. Construct one file with limit*10 matching
    // sections plus several other single-match files, and assert we still get `limit`
    // distinct files in the results.
    const dir = await makeTempAiDir();
    try {
      const limit = 5;
      // Dominant file with 50 ## sections all matching the query term heavily.
      const heavySections = Array.from(
        { length: limit * 10 },
        (_, i) => `## Section ${i}\nalpha alpha alpha alpha alpha hit-${i}\n`
      ).join("\n");
      await writeFile(join(dir, "heavy.md"), `# Top\n\n${heavySections}`);
      // Several other files, each with a single (lower-TF) matching section.
      for (let i = 0; i < limit + 3; i++) {
        await writeFile(join(dir, `other-${i}.md`), `alpha in other-${i}\n`);
      }
      const out = await hybridSearch(dir, "alpha", { mode: "keyword", limit });
      const files = out.results.map((r) => r.file);
      assert.equal(files.length, limit, `expected ${limit} results, got ${files.length}`);
      assert.equal(new Set(files).size, limit, "results must be distinct files");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ─── rankChunks: tags + includeDeprecated combined ───────────────────────────

describe("rankChunks — tags + includeDeprecated combined", () => {
  it("deprecated-rule filters [DEPRECATED] chunk even when its tags match; tag-rule filters non-deprecated chunk without tags", async () => {
    const cs = [
      // Matches the query and the tag, but is [DEPRECATED] → filtered by deprecated rule.
      chunk("a#0", "a.md", "[DEPRECATED] alpha context-x still relevant"),
      // Non-deprecated and matches query but lacks the tag → filtered by tag rule.
      chunk("b#0", "b.md", "alpha without the tag"),
      // Non-deprecated, matches query and tag → should survive.
      chunk("c#0", "c.md", "alpha context-x current"),
    ];
    const out = await rankChunks(cs, "alpha", {
      mode: "keyword",
      topK: 10,
      tags: ["context-x"],
      includeDeprecated: false,
    });
    assert.equal(out.results.length, 1);
    assert.equal(out.results[0].chunk.id, "c#0");
  });
});

// ─── loadChunks: id assignment ───────────────────────────────────────────────

describe("loadChunks — id assignment", () => {
  it("assigns chunk.id = `${file}#${i}` deterministically for sectioned files", async () => {
    const dir = await makeTempAiDir();
    try {
      const body = [
        "# Top",
        "",
        "## A",
        "text A",
        "",
        "## B",
        "text B",
      ].join("\n");
      await writeFile(join(dir, "f.md"), body);
      const chunks = await loadChunks(dir);
      const forFile = chunks.filter((c) => c.file === "f.md");
      // There's a pre-## preamble ("# Top") which becomes section 0, then ## A is 1, ## B is 2.
      const ids = forFile.map((c) => c.id).sort();
      assert.deepEqual(ids, ["f.md#0", "f.md#1", "f.md#2"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("assigns id for files without ## sections", async () => {
    const dir = await makeTempAiDir();
    try {
      await writeFile(join(dir, "plain.md"), "no sections here\njust text\n");
      const chunks = await loadChunks(dir);
      const c = chunks.find((x) => x.file === "plain.md");
      assert.ok(c);
      assert.equal(c!.id, "plain.md#0");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves relative path in id for nested files", async () => {
    const dir = await makeTempAiDir();
    try {
      await mkdir(join(dir, "memory"), { recursive: true });
      await writeFile(join(dir, "memory", "nested.md"), "## H\nbody\n");
      const chunks = await loadChunks(dir);
      const c = chunks.find((x) => x.file === "memory/nested.md");
      assert.ok(c);
      assert.ok(c!.id!.startsWith("memory/nested.md#"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Silence unused-import lint in CI if RankedChunk type is only referenced in comments.
const _typeProbe: RankedChunk | undefined = undefined;
void _typeProbe;
