/**
 * Deterministic rule-based Judge stub for CI (AMP §2.1).
 */

import type { ExecutionTrace, Judge, JudgeVerdict } from "./types.js";

/** Rule-based judge — scores output against simple heuristics, no LLM. */
export function createDeterministicJudge(): Judge {
  return {
    judge(_skillName, execution) {
      const lower = execution.output.toLowerCase();
      let score = 0.5;
      const improvements: string[] = [];

      if (lower.includes("error") || lower.includes("failed")) {
        score = 0.2;
        improvements.push("Reduce failure language in skill guidance.");
      }

      if (lower.includes("never use --no-verify") || lower.includes("do not skip hooks")) {
        score = 0.95;
      }

      if (execution.output.trim().length < 20) {
        score = Math.min(score, 0.4);
        improvements.push("Expand procedural guidance with concrete steps.");
      }

      return {
        score,
        rationale: `Deterministic judge scored trace ${execution.traceId} at ${score.toFixed(2)}.`,
        ...(improvements.length > 0 ? { suggested_improvements: improvements } : {}),
      };
    },
  };
}

/** Build a synthetic execution trace from a procedure body snippet. */
export function executionTraceFromProcedureOutput(
  skillName: string,
  output: string,
  traceId = "deterministic-trace"
): ExecutionTrace {
  return {
    traceId,
    skillName,
    input: { inputId: traceId, query: output },
    output,
    occurredAt: new Date().toISOString(),
  };
}
