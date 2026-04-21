#!/usr/bin/env node
/**
 * benchmarks/longmemeval CLI. Commands:
 *  - run          — chunk + retrieve + read; writes hypotheses.jsonl + run-manifest.json
 *  - score        — invokes upstream evaluate_qa.py via scripts/run-evaluate-qa.sh
 *  - fetch-scorer — clones upstream LongMemEval at the pinned commit
 */
import { execFile } from "child_process";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { loadDataset } from "./dataset.js";
import { loadEnvLocal, requireEnv } from "./env.js";
import { promptTemplateSha256 } from "./reader.js";
import { readJsonl } from "./jsonl.js";
import { runAll } from "./runner.js";
import type {
  DatasetName,
  Granularity,
  HypothesisRow,
  RunManifest,
  SearchMode,
} from "./types.js";

const pexec = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// dist/cli.js lives at benchmarks/longmemeval/dist/cli.js, src at src/cli.ts.
// Walk two up to reach benchmarks/longmemeval.
const BENCH_ROOT = resolve(__dirname, "..");

const EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_READER = "gemini-2.5-pro";
const DEFAULT_JUDGE = "gpt-4o-2024-08-06";

// ─── arg parsing ──────────────────────────────────────────────────────────────

interface Flags {
  positional: string[];
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): Flags {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags.set(key, true);
      } else {
        flags.set(key, next);
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function getStringFlag(f: Flags, name: string): string | undefined {
  const v = f.flags.get(name);
  if (typeof v === "string") return v;
  return undefined;
}

function getBoolFlag(f: Flags, name: string): boolean {
  return f.flags.get(name) === true;
}

function getNumberFlag(f: Flags, name: string, fallback: number): number {
  const v = getStringFlag(f, name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name} expects a number, got "${v}"`);
  return n;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function tsSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "Z");
}

async function gitHead(): Promise<string> {
  try {
    const { stdout } = await pexec("git", ["rev-parse", "HEAD"], { cwd: BENCH_ROOT });
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

// ─── run ──────────────────────────────────────────────────────────────────────

async function cmdRun(flags: Flags): Promise<void> {
  await loadEnvLocal(BENCH_ROOT);

  const dataset = (getStringFlag(flags, "dataset") ?? "") as DatasetName | "";
  if (dataset !== "oracle" && dataset !== "s") {
    throw new Error(`--dataset is required: one of [oracle, s]`);
  }
  const mode = (getStringFlag(flags, "mode") ?? "hybrid") as SearchMode;
  if (mode !== "hybrid" && mode !== "keyword" && mode !== "semantic") {
    throw new Error(`--mode must be one of [hybrid, keyword, semantic]`);
  }
  const granularity = (getStringFlag(flags, "granularity") ?? "turn") as Granularity;
  if (granularity !== "turn" && granularity !== "session") {
    throw new Error(`--granularity must be one of [turn, session]`);
  }
  const topK = getNumberFlag(flags, "topk", 10);
  const concurrency = getNumberFlag(flags, "concurrency", 4);
  const readerModel = getStringFlag(flags, "reader-model") ?? DEFAULT_READER;
  const judgeModel = getStringFlag(flags, "judge-model") ?? DEFAULT_JUDGE;

  const limitRaw = getStringFlag(flags, "limit");
  const noLimit = getBoolFlag(flags, "no-limit");
  if (limitRaw && noLimit) {
    throw new Error(`--limit and --no-limit are mutually exclusive.`);
  }
  if (!limitRaw && !noLimit) {
    throw new Error(
      `Cost safety: pass either --limit N (dry run) or --no-limit (full 500-question run). Refusing to run without an explicit choice.`
    );
  }
  const limit = limitRaw ? Number(limitRaw) : null;
  if (limit !== null && (!Number.isFinite(limit) || limit < 1)) {
    throw new Error(`--limit must be a positive integer, got "${limitRaw}"`);
  }

  const geminiApiKey = requireEnv("GEMINI_API_KEY");

  const loaded = await loadDataset(dataset);
  const questions = limit !== null ? loaded.questions.slice(0, limit) : loaded.questions;

  const outDir =
    getStringFlag(flags, "out") ?? join(BENCH_ROOT, "runs", tsSlug());
  await mkdir(outDir, { recursive: true });

  const hypothesesPath = join(outDir, "hypotheses.jsonl");
  const errorsPath = join(outDir, "errors.log");
  // Truncate existing hypotheses file to start fresh (runner appends).
  await writeFile(hypothesesPath, "", "utf-8");
  await writeFile(errorsPath, "", "utf-8");

  const startedAt = new Date().toISOString();
  process.stderr.write(
    `run: dataset=${dataset} mode=${mode} granularity=${granularity} topK=${topK} ` +
      `limit=${limit ?? "none"} concurrency=${concurrency} reader=${readerModel}\n` +
      `out:  ${outDir}\n`
  );

  const summary = await runAll(questions, {
    mode,
    granularity,
    topK,
    concurrency,
    readerModel,
    geminiApiKey,
    hypothesesPath,
    errorsPath,
  });

  const manifest: RunManifest = {
    dataset: {
      name: dataset,
      file: loaded.file,
      sha256: loaded.sha256,
      n_questions: questions.length,
    },
    retriever: { mode, topK, granularity, embed_model: EMBED_MODEL },
    reader: {
      provider: "gemini",
      model: readerModel,
      temperature: 0,
      max_output_tokens: 150,
      prompt_template_sha256: promptTemplateSha256(),
    },
    judge: { model: judgeModel },
    seed_sampling: { limit },
    timings_ms: summary.timings_ms,
    commit: await gitHead(),
    started_at: startedAt,
  };
  await writeFile(
    join(outDir, "run-manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );

  process.stderr.write(
    `done: ${summary.total} questions, ${summary.errors} errors, ` +
      `p50=${summary.timings_ms.per_question_p50}ms ` +
      `p95=${summary.timings_ms.per_question_p95}ms ` +
      `total=${summary.timings_ms.total}ms\n`
  );
}

// ─── score ────────────────────────────────────────────────────────────────────

interface EvalResultRow {
  question_id: string;
  question_type?: string;
  autoeval_label?: { model: string; label: boolean | number | string };
}

function toBool(x: unknown): boolean {
  if (typeof x === "boolean") return x;
  if (typeof x === "number") return x !== 0;
  if (typeof x === "string") return /^(1|true|yes)$/i.test(x.trim());
  return false;
}

async function cmdScore(flags: Flags): Promise<void> {
  await loadEnvLocal(BENCH_ROOT);
  const runDir = getStringFlag(flags, "run");
  if (!runDir) throw new Error(`--run <runs/<timestamp>> is required`);
  const resolvedRun = resolve(runDir);
  const hypPath = join(resolvedRun, "hypotheses.jsonl");
  const manifestPath = join(resolvedRun, "run-manifest.json");

  await stat(hypPath);
  const manifestBuf = await readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(manifestBuf) as RunManifest;

  const judgeModel = getStringFlag(flags, "judge-model") ?? manifest.judge.model;
  const dataset = manifest.dataset.name;

  const dataDir = requireEnv("LME_DATA_DIR");
  const refPath = join(dataDir, manifest.dataset.file);

  const scriptPath = join(BENCH_ROOT, "scripts", "run-evaluate-qa.sh");
  process.stderr.write(
    `score: judge=${judgeModel} dataset=${dataset} hyp=${hypPath} ref=${refPath}\n`
  );

  const { stdout } = await pexec(
    "bash",
    [scriptPath, judgeModel, hypPath, refPath],
    {
      cwd: BENCH_ROOT,
      maxBuffer: 1024 * 1024 * 64,
      env: process.env,
    }
  );
  process.stderr.write(stdout + "\n");

  const shortModel = judgeModel.replace(/\//g, "_");
  const evalResultsPath = `${hypPath}.eval-results-${shortModel}`;
  const rows = await readJsonl<EvalResultRow>(evalResultsPath);

  let correct = 0;
  const perType = new Map<string, { correct: number; total: number }>();
  for (const r of rows) {
    const label = r.autoeval_label?.label;
    const ok = toBool(label);
    const type = r.question_type ?? "unknown";
    const bucket = perType.get(type) ?? { correct: 0, total: 0 };
    bucket.total++;
    if (ok) {
      bucket.correct++;
      correct++;
    }
    perType.set(type, bucket);
  }

  const scores = {
    overall: {
      correct,
      total: rows.length,
      accuracy: rows.length ? correct / rows.length : 0,
    },
    per_type: Object.fromEntries(
      [...perType.entries()].map(([k, v]) => [
        k,
        { correct: v.correct, total: v.total, accuracy: v.total ? v.correct / v.total : 0 },
      ])
    ),
    judge: judgeModel,
    eval_results_path: evalResultsPath,
  };

  const scoresPath = join(resolvedRun, "scores.json");
  await writeFile(scoresPath, JSON.stringify(scores, null, 2), "utf-8");
  process.stderr.write(
    `scores: overall=${(scores.overall.accuracy * 100).toFixed(2)}% ` +
      `(${correct}/${rows.length}); wrote ${scoresPath}\n`
  );
}

// ─── fetch-scorer ─────────────────────────────────────────────────────────────

async function cmdFetchScorer(_flags: Flags): Promise<void> {
  const scriptPath = join(BENCH_ROOT, "scripts", "fetch-scorer.sh");
  const { stdout, stderr } = await pexec("bash", [scriptPath], {
    cwd: BENCH_ROOT,
    maxBuffer: 1024 * 1024 * 64,
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

// ─── help ─────────────────────────────────────────────────────────────────────

function printHelp(): void {
  process.stdout.write(
    `ai-memory-bench — LongMemEval Phase 1 harness

Usage:
  run          --dataset oracle|s --mode hybrid|keyword|semantic
               --granularity turn|session --topk 10
               (--limit N | --no-limit)
               [--reader-model gemini-2.5-pro] [--judge-model gpt-4o-2024-08-06]
               [--concurrency 4] [--out runs/<timestamp>]

  score        --run runs/<timestamp> [--judge-model gpt-4o-2024-08-06]

  fetch-scorer    clone upstream LongMemEval at the pinned SHA into third_party/

Environment:
  LME_DATA_DIR     required. Absolute path to the dataset directory.
  GEMINI_API_KEY   required for \`run\`.
  OPENAI_API_KEY   required for \`score\` (consumed by upstream evaluate_qa.py).

Reads benchmarks/longmemeval/.env.local for the above. Shell env overrides the file.
`
  );
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  const flags = parseArgs(rest);
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    printHelp();
    return;
  }
  switch (cmd) {
    case "run":
      if (flags.flags.has("help")) {
        printHelp();
        return;
      }
      await cmdRun(flags);
      return;
    case "score":
      await cmdScore(flags);
      return;
    case "fetch-scorer":
      await cmdFetchScorer(flags);
      return;
    default:
      process.stderr.write(`unknown command: ${cmd}\n`);
      printHelp();
      process.exitCode = 2;
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`error: ${msg}\n`);
  process.exitCode = 1;
});
