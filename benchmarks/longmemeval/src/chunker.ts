/**
 * Adapt a LongMemEval question's `haystack_sessions` into ai-memory `Chunk[]`.
 *
 * Two granularities (see specs/plan.md):
 *  - turn:    one Chunk per turn.    id="${qid}::s${si}::t${ti}", file="${qid}::s${si}"
 *  - session: one Chunk per session. id="${qid}::s${si}",          file="${qid}::s${si}"
 *
 * The `content` field on Chunk is required by the shared type but unused by
 * retrieval — we set it to "" to keep memory pressure flat on large haystacks.
 */
import type { Chunk } from "../../../src/hybrid-search/index.js";
import type { Granularity, LMEQuestion } from "./types.js";

export interface ChunkOptions {
  granularity: Granularity;
}

export function chunkQuestion(q: LMEQuestion, opts: ChunkOptions): Chunk[] {
  return opts.granularity === "turn" ? chunkByTurn(q) : chunkBySession(q);
}

function chunkByTurn(q: LMEQuestion): Chunk[] {
  const chunks: Chunk[] = [];
  for (let si = 0; si < q.haystack_sessions.length; si++) {
    const session = q.haystack_sessions[si] ?? [];
    const date = q.haystack_dates[si] ?? "";
    for (let ti = 0; ti < session.length; ti++) {
      const turn = session[ti];
      if (!turn || !turn.content) continue;
      chunks.push({
        id: `${q.question_id}::s${si}::t${ti}`,
        file: `${q.question_id}::s${si}`,
        text: `[${date}] ${turn.role}: ${turn.content}`,
        content: "",
      });
    }
  }
  return chunks;
}

function chunkBySession(q: LMEQuestion): Chunk[] {
  const chunks: Chunk[] = [];
  for (let si = 0; si < q.haystack_sessions.length; si++) {
    const session = q.haystack_sessions[si] ?? [];
    const date = q.haystack_dates[si] ?? "";
    const lines: string[] = [];
    for (const turn of session) {
      if (!turn || !turn.content) continue;
      lines.push(`${turn.role}: ${turn.content}`);
    }
    if (lines.length === 0) continue;
    chunks.push({
      id: `${q.question_id}::s${si}`,
      file: `${q.question_id}::s${si}`,
      text: `[${date}]\n${lines.join("\n")}`,
      content: "",
    });
  }
  return chunks;
}
