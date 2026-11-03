/**
 * Deterministic qrels-style Eval (AMP §2.1) — LLM-free.
 */

import type { CanonicalProcedure } from "../../procedural/schema.js";
import type { CorrectionCorpusEntry, Eval, EvalExpected, EvalInput, EvalScore } from "./types.js";

function scoreBodyAgainstExpected(body: string, expected: EvalExpected): EvalScore {
  const matched: string[] = [];
  const missed: string[] = [];

  for (const token of expected.mustContain) {
    if (body.includes(token)) {
      matched.push(token);
    } else {
      missed.push(token);
    }
  }

  for (const token of expected.mustNotContain) {
    if (body.includes(token)) {
      missed.push(`!${token}`);
    } else {
      matched.push(`!${token}`);
    }
  }

  const total = expected.mustContain.length + expected.mustNotContain.length;
  const score = total === 0 ? 1 : matched.length / total;

  return { score, matched, missed };
}

function corpusEntryToExpected(entry: CorrectionCorpusEntry): EvalExpected {
  const mustContain = [...entry.mustContain];
  if (entry.expectedBehavior && !mustContain.includes(entry.expectedBehavior)) {
    mustContain.push(entry.expectedBehavior);
  }

  const mustNotContain = [...entry.mustNotContain];
  if (entry.avoidPhrase && !mustNotContain.includes(entry.avoidPhrase)) {
    mustNotContain.push(entry.avoidPhrase);
  }

  return { mustContain, mustNotContain };
}

/** Deterministic qrels-style evaluator for optimization cycles. */
export function createDeterministicEval(): Eval {
  return {
    run(_skillName, _input, expected) {
      return scoreBodyAgainstExpected(_input.query, expected);
    },

    scoreProcedure(_skillName, procedure, corpus) {
      if (corpus.length === 0) {
        return 1;
      }

      let total = 0;
      let earned = 0;
      for (const entry of corpus) {
        const expected = corpusEntryToExpected(entry);
        const result = scoreBodyAgainstExpected(procedure.body, expected);
        const checks = expected.mustContain.length + expected.mustNotContain.length;
        total += checks;
        earned += result.matched.length;
      }

      return total === 0 ? 1 : earned / total;
    },
  };
}

/** Aggregate qrels for a corpus subset. */
export function scoreProcedureOnCorpus(
  procedure: CanonicalProcedure,
  corpus: readonly CorrectionCorpusEntry[],
  evalImpl: Eval = createDeterministicEval()
): number {
  return evalImpl.scoreProcedure(procedure.frontmatter.name, procedure, corpus);
}
