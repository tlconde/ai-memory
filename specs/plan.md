# Plan: LongMemEval Phase 1 baseline harness

## Layout

```
benchmarks/longmemeval/
  README.md                      # how to run, prereqs
  tsconfig.json                  # extends root, rootDir=./src, outDir=./dist, composite
  src/
    types.ts                     # LongMemEval record schema, run manifest
    dataset.ts                   # fetch + parse + hash
    chunker.ts                   # haystack_sessions -> Chunk[] (turn | session)
    retriever.ts                 # wraps rankChunks with embedding cache
    reader.ts                    # OpenAI client, pinned model, prompt template
    runner.ts                    # per-question pipeline
    jsonl.ts                     # read/write JSONL
    cli.ts                       # entrypoint
  scripts/
    fetch-dataset.sh             # curl from HF resolve URLs
    run-evaluate-qa.sh           # invokes upstream evaluate_qa.py
  python/
    requirements.txt             # openai, tqdm — for evaluate_qa.py
  data/                          # gitignored; datasets downloaded here
  runs/                          # gitignored; JSONL outputs + manifests
```

## Dependencies

**Node (new):** `openai` (devDep, used only by bench). Pin to latest 4.x.
**Python:** use the upstream LongMemEval repo's `evaluate_qa.py` via a local clone or submodule under `benchmarks/longmemeval/third_party/longmemeval/`. We do NOT vendor their code; we clone to a pinned commit.

## Data location (external, not in repo)

Datasets live on an external SSD, not the laptop or the repo. The harness resolves the directory from `LME_DATA_DIR` (required; no default path-hunting).

```
LME_DATA_DIR="/Volumes/SSD EXT/ai-memory-bench-data/longmemeval"
├── longmemeval_oracle.json       15M  sha256=821a2034d219ab45846873dd14c14f12cfe7776e73527a483f9dac095d38620c
├── longmemeval_s_cleaned.json   265M  sha256=d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442
└── sha256.txt                         reference hash file
```

Hashes recorded 2026-04-20. Harness verifies the hash on load and aborts on mismatch (wrong file, partial download, upstream update).

## Schema (types.ts)

```ts
export interface LMETurn { role: "user" | "assistant"; content: string; has_answer?: boolean }
export interface LMEQuestion {
  question_id: string;          // "_abs" suffix marks abstention questions
  question_type: string;
  question: string;
  answer: string;
  question_date: string;
  haystack_session_ids: string[];
  haystack_dates: string[];
  haystack_sessions: LMETurn[][];
  answer_session_ids: string[];
}
export interface RunManifest {
  dataset: { name: "oracle" | "s" | "m"; file: string; sha256: string; n_questions: number };
  retriever: { mode: "hybrid" | "keyword" | "semantic"; topK: number; granularity: "turn" | "session"; embed_model: string };
  reader: { provider: "openai"; model: string; temperature: 0; max_output_tokens: number; prompt_template: string };
  judge: { model: string };     // recorded from CLI args; actual invocation is upstream
  seed_sampling: { limit?: number; seed: number };
  timings_ms: { total: number; per_question_p50: number; per_question_p95: number };
  commit: string;               // git HEAD when run
  started_at: string;           // ISO-8601
}
```

## Chunker contract

- **turn granularity:** one `Chunk` per turn. `id = "<qid>::s<si>::t<ti>"`. `file = "<qid>::s<si>"` (session stand-in for dedupe). `text` = `[<date>] <role>: <content>`.
- **session granularity:** one `Chunk` per session. `id = "<qid>::s<si>"`. `file = "<qid>::s<si>"`. `text` = `[<date>]\n<role>: ...\n<role>: ...` (joined turns).
- No filesystem I/O. Pure function: `chunkQuestion(q: LMEQuestion, opts: {granularity}) => Chunk[]`.

## Retriever contract

- `retrieve(chunks, query, {mode, topK, cacheKey})` → `RankedChunk[]` via `rankChunks`.
- Embedding cache: keyed by `cacheKey` (per-question `question_id`). Computes once per question; reused across modes if the harness re-runs.
- Disk cache under `runs/.embed-cache/<hash>.bin` optional — skip in v1, add if needed.

## Reader contract

- `read(question, chunks, opts)` → `{hypothesis: string, usage: {input_tokens, output_tokens}}`.
- Prompt template (committed as constant, hashed into manifest):
  ```
  You are answering a question based on prior conversation excerpts.

  Excerpts (in temporal order, dated):
  <for each chunk>[<date>] <role>: <content></for>

  Question (asked on <question_date>): <question>

  Instructions:
  - If the excerpts contain the answer, state it concisely.
  - If the excerpts do not contain the answer, reply exactly: "I don't know".
  - Do not speculate.

  Answer:
  ```
- API key from `OPENAI_API_KEY` (env). `.env.local` loaded at startup via `dotenv` or manual parse — manual parse to avoid new dep.

## Runner contract

- `runAll(questions, config)` loops questions, produces JSONL rows. Concurrency: 4 parallel reader calls (safe for rate limits at GPT-4o ~5k RPM tier; adjustable via env).
- Progress bar — simple console line, no dep.
- On error per-question: record `{question_id, hypothesis: "[ERROR] <msg>", error: true}` and continue.

## CLI (cli.ts)

```
ai-memory-bench run \
  --dataset oracle|s|m \
  --mode hybrid|keyword|semantic \
  --granularity turn|session \
  --topk 10 \
  --limit 10 \        # optional, dry-run
  --reader-model gpt-4o-2024-08-06 \
  --judge-model gpt-4o-2024-08-06 \
  --out runs/<timestamp>
```

Writes: `runs/<timestamp>/hypotheses.jsonl`, `runs/<timestamp>/run-manifest.json`, `runs/<timestamp>/errors.log`.

Second subcommand:
```
ai-memory-bench score --run runs/<timestamp>
```
Invokes `scripts/run-evaluate-qa.sh` under the hood, parses the Python scorer output, writes `runs/<timestamp>/scores.json` with overall + per-type.

## Build & test

- `benchmarks/longmemeval/tsconfig.json` extends root, `"composite": true`, output `benchmarks/longmemeval/dist/`.
- Not in published npm package (`files` in root package.json does not list `benchmarks/`).
- Unit tests: `chunker.test.ts`, `jsonl.test.ts`, `dataset.test.ts` (hash verification). Reader + runner not unit-tested (integration, costs $$).
- Run via: `node --import tsx --test "benchmarks/longmemeval/src/**/*.test.ts"` — same pattern as src tests.

## Risks

- **HF rate limiting** on dataset download: use resolve URL + `curl -L`, cache to `data/`.
- **evaluate_qa.py drift:** pin upstream commit hash in `scripts/run-evaluate-qa.sh`.
- **OpenAI cost explosion on accidental full runs:** require explicit `--no-limit` flag to run >50 questions. Otherwise `--limit` is required.
- **Embedding throughput:** 500 questions × ~50 chunks each × MiniLM = ~25k embeddings per run. Batching (already done in `rankChunks`) handles it.
