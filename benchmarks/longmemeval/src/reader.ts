/**
 * Gemini reader. Given a question + ranked chunks, returns a hypothesis string
 * and token usage. Pinned model, temperature 0, max_output_tokens 150.
 *
 * Retries transient errors (429 / 500 / 503) up to 3 times with exponential
 * backoff (1s, 2s, 4s). Throws on persistent failure — the runner catches and
 * writes a `[ERROR]` hypothesis row.
 */
import { createHash } from "crypto";
import type { RankedChunk } from "../../../src/hybrid-search/index.js";

export const PROMPT_TEMPLATE = `You are answering a question based on prior conversation excerpts.

Excerpts (in temporal order, dated):
{EXCERPTS}

Question (asked on {QUESTION_DATE}): {QUESTION}

Instructions:
- If the excerpts contain the answer, state it concisely.
- If the excerpts do not contain the answer, reply exactly: "I don't know".
- Do not speculate.

Answer:`;

export function promptTemplateSha256(): string {
  return createHash("sha256").update(PROMPT_TEMPLATE).digest("hex");
}

export interface ReadInput {
  question: string;
  question_date: string;
  chunks: RankedChunk[];
}

export interface ReadOptions {
  model: string;
  apiKey: string;
  /** Override for tests; default is the real @google/genai client. */
  client?: GenaiLike;
  maxRetries?: number;
  /** Test hook: sleep function. */
  sleep?: (ms: number) => Promise<void>;
}

export interface ReadResult {
  hypothesis: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** Minimal interface matching what we use from @google/genai's GoogleGenAI. */
export interface GenaiLike {
  models: {
    generateContent(req: {
      model: string;
      contents: string;
      config: { temperature: number; maxOutputTokens: number };
    }): Promise<{
      text?: string;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    }>;
  };
}

export function buildPrompt(input: ReadInput): string {
  const excerpts = input.chunks.length
    ? input.chunks.map((r) => r.chunk.text).join("\n")
    : "(no excerpts retrieved)";
  return PROMPT_TEMPLATE.replace("{EXCERPTS}", excerpts)
    .replace("{QUESTION_DATE}", input.question_date)
    .replace("{QUESTION}", input.question);
}

const TRANSIENT_STATUS = new Set([429, 500, 502, 503, 504]);

function isTransient(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; code?: number; message?: string };
  if (typeof e.status === "number" && TRANSIENT_STATUS.has(e.status)) return true;
  if (typeof e.code === "number" && TRANSIENT_STATUS.has(e.code)) return true;
  if (typeof e.message === "string") {
    if (/\b(429|500|502|503|504)\b/.test(e.message)) return true;
    if (/rate ?limit|temporarily unavailable|overloaded/i.test(e.message)) return true;
  }
  return false;
}

async function getDefaultClient(apiKey: string): Promise<GenaiLike> {
  const mod = (await import("@google/genai")) as {
    GoogleGenAI: new (args: { apiKey: string }) => GenaiLike;
  };
  return new mod.GoogleGenAI({ apiKey });
}

export async function read(
  input: ReadInput,
  options: ReadOptions
): Promise<ReadResult> {
  const client = options.client ?? (await getDefaultClient(options.apiKey));
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxRetries = options.maxRetries ?? 3;
  const prompt = buildPrompt(input);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await client.models.generateContent({
        model: options.model,
        contents: prompt,
        config: { temperature: 0, maxOutputTokens: 150 },
      });
      const text = (resp.text ?? "").trim();
      const inputTokens = resp.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = resp.usageMetadata?.candidatesTokenCount ?? 0;
      return { hypothesis: text, usage: { inputTokens, outputTokens } };
    } catch (err) {
      lastErr = err;
      if (attempt >= maxRetries || !isTransient(err)) break;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
