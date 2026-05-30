/**
 * Optimization sub-layer types (AMP §4.3.5 / §2.1).
 *
 * Falsifiable claim: eval, judge, optimizer, and validation-gate payloads validate
 * with strict schemas where serialized to audit or CLI output.
 */

import { z } from "zod";

import type { CanonicalProcedure } from "../../procedural/schema.js";

export const EvalInputSchema = z
  .object({
    inputId: z.string().min(1),
    query: z.string(),
    context: z.string().optional(),
  })
  .strict();

export type EvalInput = z.infer<typeof EvalInputSchema>;

export const EvalExpectedSchema = z
  .object({
    mustContain: z.array(z.string().min(1)).default([]),
    mustNotContain: z.array(z.string().min(1)).default([]),
  })
  .strict();

export type EvalExpected = z.infer<typeof EvalExpectedSchema>;

export const EvalScoreSchema = z
  .object({
    score: z.number().min(0).max(1),
    matched: z.array(z.string()),
    missed: z.array(z.string()),
  })
  .strict();

export type EvalScore = z.infer<typeof EvalScoreSchema>;

export const ExecutionTraceSchema = z
  .object({
    traceId: z.string().min(1),
    skillName: z.string().min(1),
    input: EvalInputSchema,
    output: z.string(),
    occurredAt: z.string().datetime(),
  })
  .strict();

export type ExecutionTrace = z.infer<typeof ExecutionTraceSchema>;

export const JudgeVerdictSchema = z
  .object({
    score: z.number().min(0).max(1),
    rationale: z.string().min(1),
    suggested_improvements: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

export const EditBudgetSchema = z
  .object({
    max_lines_changed: z.number().int().positive(),
    max_chars_changed: z.number().int().positive(),
    preserve_sections: z.array(z.string().min(1)),
    max_frontmatter_keys_changed: z.number().int().nonnegative(),
  })
  .strict();

export type EditBudget = z.infer<typeof EditBudgetSchema>;

export const ProposedEditBudgetUsedSchema = z
  .object({
    linesChanged: z.number().int().nonnegative(),
    charsChanged: z.number().int().nonnegative(),
    frontmatterKeysChanged: z.number().int().nonnegative(),
  })
  .strict();

export type ProposedEditBudgetUsed = z.infer<typeof ProposedEditBudgetUsedSchema>;

export const ProposedEditSchema = z
  .object({
    skillName: z.string().min(1),
    unifiedDiff: z.string(),
    bodyAfter: z.string(),
    budgetUsed: ProposedEditBudgetUsedSchema,
    cycle: z.number().int().positive().optional(),
  })
  .strict();

export type ProposedEdit = z.infer<typeof ProposedEditSchema>;

export const CorrectionCorpusEntrySchema = z
  .object({
    id: z.string().min(1),
    skillName: z.string().min(1),
    summary: z.string().min(1),
    expectedBehavior: z.string().min(1).optional(),
    avoidPhrase: z.string().min(1).optional(),
    mustContain: z.array(z.string().min(1)).default([]),
    mustNotContain: z.array(z.string().min(1)).default([]),
    occurredAt: z.string().datetime(),
    holdout: z.boolean().default(false),
  })
  .strict();

export type CorrectionCorpusEntry = z.infer<typeof CorrectionCorpusEntrySchema>;

export const ValidationResultSchema = z
  .object({
    decision: z.enum(["accept", "reject"]),
    scoreBefore: z.number().min(0).max(1),
    scoreAfter: z.number().min(0).max(1),
    reasons: z.array(z.string()),
    reject_reason: z.string().min(1).optional(),
  })
  .strict();

export type ValidationResult = z.infer<typeof ValidationResultSchema>;

/** Score a single skill execution against expected outcomes (§2.1). */
export interface Eval {
  run(skillName: string, input: EvalInput, expected: EvalExpected): EvalScore;
  scoreProcedure(skillName: string, procedure: CanonicalProcedure, corpus: readonly CorrectionCorpusEntry[]): number;
}

/** LLM-as-judge wrapper; in-memory ships a deterministic rule-based stub. */
export interface Judge {
  judge(skillName: string, execution: ExecutionTrace): JudgeVerdict;
}

/** Propose bounded edits to a SKILL.md body — pure, no writes (§2.1). */
export interface Optimizer {
  propose(
    current: CanonicalProcedure,
    corpus: readonly CorrectionCorpusEntry[],
    judgments: readonly JudgeVerdict[],
    budget: EditBudget
  ): ProposedEdit | undefined;
}

/** Accept only if holdout score strictly improves and budget is respected. */
export interface ValidationGate {
  validate(
    before: CanonicalProcedure,
    after: CanonicalProcedure,
    holdoutCorpus: readonly CorrectionCorpusEntry[],
    budget: EditBudget,
    proposed: ProposedEdit
  ): ValidationResult;
}

export const OptimizationCycleOutcomeSchema = z
  .object({
    skillName: z.string().min(1),
    proposed: z.boolean(),
    accepted: z.boolean(),
    cyclesRun: z.number().int().nonnegative(),
    finalScore: z.number().min(0).max(1),
    reject_reason: z.string().optional(),
    auditRecordId: z.string().optional(),
  })
  .strict();

export type OptimizationCycleOutcome = z.infer<typeof OptimizationCycleOutcomeSchema>;
