/**
 * Run pipeline: chunk → retrieve → read → write JSONL row. Concurrency N.
 * Per-question errors are captured (never aborting the run).
 */
import { appendFile } from "fs/promises";
import type { RankedChunk } from "../../../src/hybrid-search/index.js";
import { chunkQuestion } from "./chunker.js";
import { appendJsonl } from "./jsonl.js";
import { read, type ReadOptions, type ReadResult } from "./reader.js";
import { Retriever } from "./retriever.js";
import type {
  Granularity,
  HypothesisRow,
  LMEQuestion,
  SearchMode,
} from "./types.js";

export interface RunConfig {
  mode: SearchMode;
  granularity: Granularity;
  topK: number;
  concurrency: number;
  readerModel: string;
  geminiApiKey: string;
  hypothesesPath: string;
  errorsPath: string;
  /** Test hook: replace the reader entirely. */
  readFn?: (q: LMEQuestion, chunks: RankedChunk[]) => Promise<ReadResult>;
  /** Test hook: replace the retriever. */
  retriever?: Retriever;
  /** Test hook: progress sink. Default prints to stderr. */
  onProgress?: (p: ProgressEvent) => void;
}

export interface ProgressEvent {
  done: number;
  total: number;
  qid: string;
  question_type: string;
  elapsed_ms: number;
  eta_ms: number;
  error?: boolean;
}

export interface RunSummary {
  total: number;
  errors: number;
  timings_ms: { total: number; per_question_p50: number; per_question_p95: number };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function truncateForLog(s: string, n = 500): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

function defaultProgress(p: ProgressEvent): void {
  const elapsedS = Math.round(p.elapsed_ms / 1000);
  const etaMin = Math.floor(p.eta_ms / 60000);
  const etaSec = Math.round((p.eta_ms % 60000) / 1000);
  const eta = etaMin > 0 ? `${etaMin}m${etaSec}s` : `${etaSec}s`;
  const tag = p.error ? " [ERROR]" : "";
  process.stderr.write(
    `[${p.done}/${p.total}] qid=${p.qid} type=${p.question_type} elapsed=${elapsedS}s eta=${eta}${tag}\n`
  );
}

export async function runAll(
  questions: LMEQuestion[],
  config: RunConfig
): Promise<RunSummary> {
  const retriever = config.retriever ?? new Retriever();
  const onProgress = config.onProgress ?? defaultProgress;
  const total = questions.length;
  const timings: number[] = [];
  const start = Date.now();
  let done = 0;
  let errors = 0;

  // Worker pool over a shared index counter.
  let next = 0;
  const workerCount = Math.max(1, config.concurrency);

  async function runOne(q: LMEQuestion): Promise<void> {
    const t0 = Date.now();
    let row: HypothesisRow;
    let errorRow = false;
    try {
      const chunks = chunkQuestion(q, { granularity: config.granularity });
      const query = q.question;
      const cacheKey = `${q.question_id}::${config.granularity}::${config.mode}::${config.topK}`;
      const ranked = await retriever.retrieve(chunks, query, {
        mode: config.mode,
        topK: config.topK,
        cacheKey,
      });

      let result: ReadResult;
      if (config.readFn) {
        result = await config.readFn(q, ranked);
      } else {
        const readOpts: ReadOptions = {
          model: config.readerModel,
          apiKey: config.geminiApiKey,
        };
        result = await read(
          { question: q.question, question_date: q.question_date, chunks: ranked },
          readOpts
        );
      }
      row = {
        question_id: q.question_id,
        hypothesis: result.hypothesis,
        question_type: q.question_type,
      };
    } catch (err) {
      errorRow = true;
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      row = {
        question_id: q.question_id,
        hypothesis: `[ERROR] ${truncateForLog(msg, 200)}`,
        question_type: q.question_type,
        error: true,
      };
      await appendFile(
        config.errorsPath,
        `[${new Date().toISOString()}] ${q.question_id}\n${truncateForLog(msg, 2000)}\n\n`,
        "utf-8"
      );
    }
    await appendJsonl(config.hypothesesPath, row);

    const elapsed = Date.now() - t0;
    timings.push(elapsed);
    done++;
    const totalElapsed = Date.now() - start;
    const avg = totalElapsed / done;
    const eta = Math.max(0, Math.round(avg * (total - done)));
    onProgress({
      done,
      total,
      qid: q.question_id,
      question_type: q.question_type,
      elapsed_ms: totalElapsed,
      eta_ms: eta,
      error: errorRow,
    });
  }

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= questions.length) return;
      await runOne(questions[i]);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const sorted = [...timings].sort((a, b) => a - b);
  return {
    total,
    errors,
    timings_ms: {
      total: Date.now() - start,
      per_question_p50: percentile(sorted, 50),
      per_question_p95: percentile(sorted, 95),
    },
  };
}
