# Hybrid Search Experiment Report

**Date:** 2026-03-15  
**Approaches tested:** A (QMD) vs B (In-house Transformers.js + RRF)  
**Environment:** Windows (both hit platform-specific blockers)

---

## Executive Summary

| Approach | Recall (5 queries) | Avg Latency | Setup Time | Windows Status |
|----------|-------------------|-------------|------------|----------------|
| **A: QMD** | 2/5 (40%) | 5 ms | 266 s | Degraded: BM25 only (sqlite-vec fails) |
| **B: In-house** | 5/5 (100%) | 22 ms | 217 s | Blocked: onnxruntime-node missing Windows bins |

**Recommendation:** **Approach B (in-house)** — better recall when hybrid runs, lighter model (~23MB vs ~1GB), full control. Both need Windows compatibility work.

---

## Detailed Results

### Approach A: QMD

**What ran:** BM25 keyword search only. Vector embeddings failed because `sqlite-vec` extension cannot load on this Windows setup.

| Query | Recall | Latency (ms) | Notes |
|-------|--------|---------------|-------|
| PostgreSQL connection pooling | ✓ | 45, 4, 3 | Exact keyword match |
| database connection management | ✗ | 1, 1, 1 | Semantic — no vector |
| authentication strategy | ✓ | 3, 3, 2 | Exact match |
| login and signup flow | ✗ | 7, 1, 1 | Semantic — no vector |
| OOM memory leak | ✗ | 2, 1, 1 | Hybrid — "OOM" matches but "memory leak" context missed |

**Blocker:** `sqlite-vec` requires SQLite with extension loading. Windows builds often lack this.

---

### Approach B: In-house (Transformers.js + keyword + RRF)

**What ran:** Full hybrid pipeline (keyword + semantic + RRF) when executed on Linux/Mac. On Windows, `onnxruntime-node` has empty `win32/x64` binaries.

| Query | Recall | Latency (ms) | Notes |
|-------|--------|---------------|-------|
| PostgreSQL connection pooling | ✓ | 33, 22, 18 | Keyword + semantic |
| database connection management | ✓ | 26, 12, 13 | Semantic (synonym for pooling) |
| authentication strategy | ✓ | 23, 13, 14 | Semantic |
| login and signup flow | ✓ | 43, 27, 25 | Semantic (auth-related) |
| OOM memory leak | ✓ | 26, 17, 14 | Hybrid — debugging.md top result |

**Blocker:** `@huggingface/transformers` depends on `onnxruntime-node`, which does not ship Windows prebuilt binaries in the npm package.

---

## Why In-house Won (When It Ran)

1. **Recall:** 5/5 vs 2/5. Semantic queries ("database connection management", "login and signup flow") require vector search. QMD fell back to BM25; in-house had full hybrid.

2. **Model size:** 23MB (all-MiniLM-L6-v2) vs QMD's ~1GB (Jina v3). Lighter for users and CI.

3. **Control:** In-house is pure TypeScript; no Rust/WASM, no external CLI. Easier to integrate into ai-memory's MCP server.

4. **Setup time:** 217s vs 266s (both first-run model download). Comparable.

5. **Latency:** 22ms vs 5ms. In-house is slower but acceptable for memory search (sub-100ms).

---

## Platform Limitations

| Platform | QMD | In-house |
|----------|-----|----------|
| **Linux** | ✓ Full hybrid | ✓ Full hybrid |
| **macOS** | ✓ Full hybrid | ✓ Full hybrid |
| **Windows** | BM25 only (sqlite-vec) | Blocked (onnxruntime) |

**Mitigation options:**
- **Transformers.js:** Use WASM backend instead of Node native (slower but cross-platform)
- **QMD:** Document that full hybrid requires Linux/Mac; or wait for sqlite-vec Windows support
- **Fallback:** On Windows, default to keyword-only; document semantic/hybrid as Linux/Mac

---

## Recommendation

**Proceed with Approach B (in-house hybrid pipeline)** for ai-memory:

1. Implement keyword + Transformers.js semantic + RRF as in `sandbox-b-inhouse/run.js`
2. Add config: `AI_SEARCH=keyword|semantic|hybrid`
3. Investigate Transformers.js WASM backend for Windows compatibility
4. Document: "Semantic/hybrid search requires Linux or macOS; Windows uses keyword-only until onnxruntime Windows support improves"

**Defer QMD integration** unless:
- Users explicitly request it
- Windows support for both improves
- You need QMD's LLM reranking (v2 feature)

---

## Artifacts

- `experiments/hybrid-search/results/qmd-results.json`
- `experiments/hybrid-search/results/inhouse-results.json`
- `experiments/hybrid-search/sandbox-a-qmd/run-qmd-experiment.mjs`
- `experiments/hybrid-search/sandbox-b-inhouse/run.js` — reusable reference implementation
