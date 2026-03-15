# Hybrid Search Experiment

Compares **Approach A (QMD)** vs **Approach B (in-house Transformers.js + RRF)** for ai-memory semantic/hybrid search.

## Quick Start

**All platforms (Windows uses WSL automatically):**

```bash
node experiments/hybrid-search/run-all.js
```

**Linux/Mac/WSL directly:**

```bash
./experiments/hybrid-search/run-all.sh
```

**Individual runs:**

```bash
# Approach A (QMD) - requires Linux/Mac/WSL for full hybrid
cd sandbox-a-qmd && npm install && node run-qmd-experiment.mjs

# Approach B (in-house) - requires Linux/Mac/WSL
cd sandbox-b-inhouse && npm install && node run.js
```

**Windows:** In-house uses a loader to redirect onnxruntime-node → onnxruntime-web (WASM). QMD uses BM25 only when sqlite-vec fails.

## Results

See [EXPERIMENT_REPORT.md](./EXPERIMENT_REPORT.md) for full analysis.

**TL;DR:** In-house wins on recall (5/5 vs 2/5 when QMD falls back to BM25 on Windows). Both have Windows blockers; run on Linux/Mac for full comparison.

## Files

| File | Purpose |
|------|---------|
| `EXPERIMENT_SPEC.md` | Shared test queries and metrics |
| `test-data/.ai/` | Sample memory (decisions, patterns, debugging) |
| `sandbox-a-qmd/` | QMD experiment script |
| `sandbox-b-inhouse/` | In-house hybrid script (reference impl) |
| `results/*.json` | Raw results from each approach |
| `EXPERIMENT_REPORT.md` | Comparison and recommendation |
