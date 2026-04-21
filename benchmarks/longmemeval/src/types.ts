/**
 * LongMemEval dataset schema + run manifest types.
 */

export interface LMETurn {
  role: "user" | "assistant";
  content: string;
  has_answer?: boolean;
}

export interface LMEQuestion {
  /** "_abs" suffix marks abstention questions. */
  question_id: string;
  question_type: string;
  question: string;
  answer: string;
  question_date: string;
  haystack_session_ids: string[];
  haystack_dates: string[];
  haystack_sessions: LMETurn[][];
  answer_session_ids: string[];
}

export type DatasetName = "oracle" | "s";
export type SearchMode = "hybrid" | "keyword" | "semantic";
export type Granularity = "turn" | "session";

export interface RunManifest {
  dataset: { name: DatasetName; file: string; sha256: string; n_questions: number };
  retriever: {
    mode: SearchMode;
    topK: number;
    granularity: Granularity;
    embed_model: string;
  };
  reader: {
    provider: "gemini";
    model: string;
    temperature: 0;
    max_output_tokens: number;
    prompt_template_sha256: string;
  };
  judge: { model: string };
  seed_sampling: { limit: number | null };
  timings_ms: { total: number; per_question_p50: number; per_question_p95: number };
  commit: string;
  started_at: string;
}

export interface HypothesisRow {
  question_id: string;
  hypothesis: string;
  question_type?: string;
  error?: boolean;
}
