# QMD Sandbox (Approach A)

Experiment for hybrid search using [@tobilu/qmd](https://github.com/tobi/qmd).

## Setup

```bash
npm install
```

## Run Queries

Uses local index at `./index.sqlite` (created by `run-full.mjs` on first run).

```bash
node run-queries-only.mjs
```

Results written to `../results/qmd-results.json`.

## Blockers

- **Windows**: `sqlite-vec` extension not available → vector search and `qmd embed` fail. Use `searchLex` (BM25) only.
- **Full hybrid**: `qmd query` downloads 1.28GB expansion model; `qmd vsearch` also triggers it.
