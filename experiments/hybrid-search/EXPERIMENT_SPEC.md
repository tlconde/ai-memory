# Hybrid Search Experiment Spec

**Purpose:** Compare Approach A (QMD) vs Approach B (in-house Transformers.js + RRF) on identical test data and queries.

## Test Data

Use the `.ai/` structure in `experiments/hybrid-search/test-data/`. It contains:
- `memory/decisions.md` — architectural decisions (auth, DB, API)
- `memory/patterns.md` — code patterns and anti-patterns
- `memory/debugging.md` — bug fixes and root causes

## Test Queries (run all 5)

| # | Query | Type | Expected: should find |
|---|-------|------|------------------------|
| 1 | `PostgreSQL connection pooling` | Keyword | decisions.md (exact terms) |
| 2 | `database connection management` | Semantic | Same content (synonym) |
| 3 | `authentication strategy` | Semantic | decisions.md (auth) |
| 4 | `login and signup flow` | Semantic | Same (auth) |
| 5 | `OOM memory leak` | Hybrid | debugging.md (exact + context) |

## Metrics to Collect

For each query, run 3 times and report:

| Metric | How to measure |
|--------|----------------|
| **Latency (ms)** | Time from query start to first result |
| **Top-3 relevance** | Manual: 1=wrong, 2=related, 3=exact (0=no match) |
| **Recall** | Did the expected file appear in top 5? (yes/no) |
| **Setup time (s)** | Time to install + index from scratch |

## Output Format

Write results to `experiments/hybrid-search/results/<approach>-results.json`:

```json
{
  "approach": "qmd" | "in-house",
  "setup_time_seconds": 0,
  "queries": [
    {
      "query": "...",
      "latency_ms": [100, 95, 98],
      "top3_relevance": 3,
      "recall": true,
      "results_preview": ["file: excerpt..."]
    }
  ],
  "avg_latency_ms": 0,
  "notes": "Any issues, model size, etc."
}
```

## Constraints

- Use Node 18+ (or Bun)
- Run in `experiments/hybrid-search/test-data/` as the .ai root
- No external API keys (local only)
