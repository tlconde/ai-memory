/**
 * Optimization loop — drain corrections, propose, validate, apply (AMP §2.3).
 *
 * Falsifiable claim: propose path is pure (no registry writes); accept path bumps
 * version, updates provenance, propagates, and writes skill_optimized audit frames.
 */

import type { ProcedureRegistry } from "../../procedural/registry.js";
import { parseCanonicalProcedure, type CanonicalProcedure } from "../../procedural/schema.js";
import type { RuntimeStore } from "../storage/runtime-store.js";
import type { HarnessWriterRegistry } from "../propagation/types.js";
import { propagateProcedures } from "../propagation/service.js";
import { writeRuntimeSemanticEntity } from "../../runtime-semantics/storage-writer.js";
import type { RuntimeSemanticEntityRecord } from "../../runtime-semantics/entity-record.js";
import { parseEpisodicFrame } from "../../runtime-semantics/schema.js";
import {
  mapSkillOptimizationRejectedToEntityRecord,
  mapSkillOptimizedToEntityRecord,
} from "./audit-mapper.js";
import { corpusEntriesForSkill } from "./corpus.js";
import { DEFAULT_EDIT_BUDGET } from "./edit-budget.js";
import { createDeterministicEval, scoreProcedureOnCorpus } from "./eval.js";
import { createDeterministicJudge } from "./judge.js";
import { createRuleBasedOptimizer, procedureFromProposedEdit } from "./optimizer.js";
import {
  createDeterministicValidationGate,
  splitCorpusByHoldout,
} from "./validation-gate.js";
import type {
  CorrectionCorpusEntry,
  EditBudget,
  Eval,
  Judge,
  OptimizationCycleOutcome,
  Optimizer,
  ValidationGate,
} from "./types.js";

export interface RunOptimizationCycleOptions {
  skillName: string;
  registry: ProcedureRegistry;
  runtime?: RuntimeStore;
  writers?: HarnessWriterRegistry;
  corpus?: readonly CorrectionCorpusEntry[];
  runtimeRecords?: readonly RuntimeSemanticEntityRecord[];
  maxCycles?: number;
  scoreThreshold?: number;
  budget?: EditBudget;
  evalImpl?: Eval;
  judgeImpl?: Judge;
  optimizerImpl?: Optimizer;
  validationGate?: ValidationGate;
  projectRef?: string;
  syncedAt?: string;
  cycleStart?: number;
  dryRun?: boolean;
}

export interface RunOptimizationCycleResult {
  ok: boolean;
  outcomes: OptimizationCycleOutcome[];
  proposedCount: number;
  acceptedCount: number;
  silent: boolean;
  error?: string;
}

function bumpPatchVersion(version: string): string {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
    parts[2] += 1;
    return parts.join(".");
  }
  return `${version}.1`;
}

function withOptimizerProvenance(
  procedure: CanonicalProcedure,
  cycle: number,
  scoreDelta: number,
  budgetUsed: number,
  budgetMax: number,
  updatedAt: string
): CanonicalProcedure {
  const provenance = procedure.frontmatter.provenance ?? {
    source: "amp-registry" as const,
    created_at: updatedAt,
  };

  return parseCanonicalProcedure({
    ...procedure,
    frontmatter: {
      ...procedure.frontmatter,
      provenance: {
        ...provenance,
        source: "amp-registry",
        author: "amp-optimizer",
        notes: `optimizer cycle ${cycle}; scoreDelta=+${scoreDelta.toFixed(4)}; budget=${budgetUsed}/${budgetMax}`,
        updated_at: updatedAt,
      },
    },
  });
}

function writeAuditRecord(runtime: RuntimeStore | undefined, record: RuntimeSemanticEntityRecord): void {
  if (!runtime) {
    return;
  }
  const result = writeRuntimeSemanticEntity(runtime, record);
  if (!result.ok) {
    throw new Error(result.message);
  }
}

/** Run one or more optimization cycles for a single skill. */
export async function runOptimizationCycle(
  options: RunOptimizationCycleOptions
): Promise<RunOptimizationCycleResult> {
  const evalImpl = options.evalImpl ?? createDeterministicEval();
  const judgeImpl = options.judgeImpl ?? createDeterministicJudge();
  const optimizerImpl = options.optimizerImpl ?? createRuleBasedOptimizer();
  const validationGate = options.validationGate ?? createDeterministicValidationGate();
  const budget = options.budget ?? DEFAULT_EDIT_BUDGET;
  const maxCycles = options.maxCycles ?? 1;
  const scoreThreshold = options.scoreThreshold ?? 1;
  const syncedAt = options.syncedAt ?? new Date().toISOString();

  const entry = options.registry.get(options.skillName);
  if (!entry) {
    return {
      ok: false,
      outcomes: [],
      proposedCount: 0,
      acceptedCount: 0,
      silent: false,
      error: `Procedure not found: ${options.skillName}`,
    };
  }

  const corpus =
    options.corpus ??
    (options.runtimeRecords
      ? corpusEntriesForSkill(options.runtimeRecords, options.skillName)
      : []);

  if (corpus.length === 0) {
    return {
      ok: true,
      outcomes: [],
      proposedCount: 0,
      acceptedCount: 0,
      silent: true,
    };
  }

  const { train, holdout } = splitCorpusByHoldout(corpus);
  const holdoutCorpus = holdout.length > 0 ? holdout : corpus;
  const trainCorpus = train.length > 0 ? train : corpus;

  let current = structuredClone(entry.procedure);
  const outcomes: OptimizationCycleOutcome[] = [];
  let proposedCount = 0;
  let acceptedCount = 0;
  let cycle = options.cycleStart ?? 1;
  const rejectedBodyEdits = new Set<string>();

  for (; cycle <= maxCycles; cycle += 1) {
    const currentScore = scoreProcedureOnCorpus(current, holdoutCorpus, evalImpl);
    if (currentScore >= scoreThreshold) {
      break;
    }

    const judgments = [
      judgeImpl.judge(options.skillName, {
        traceId: `${options.skillName}-cycle-${cycle}`,
        skillName: options.skillName,
        input: { inputId: `cycle-${cycle}`, query: current.body.slice(0, 200) },
        output: current.body,
        occurredAt: syncedAt,
      }),
    ];

    const proposed = optimizerImpl.propose(current, trainCorpus, judgments, budget);
    if (!proposed) {
      outcomes.push({
        skillName: options.skillName,
        proposed: false,
        accepted: false,
        cyclesRun: cycle,
        finalScore: currentScore,
      });
      break;
    }

    if (rejectedBodyEdits.has(proposed.bodyAfter)) {
      outcomes.push({
        skillName: options.skillName,
        proposed: false,
        accepted: false,
        cyclesRun: cycle,
        finalScore: currentScore,
      });
      break;
    }

    proposedCount += 1;
    const candidate = procedureFromProposedEdit(current, proposed);
    const validation = validationGate.validate(current, candidate, holdoutCorpus, budget, proposed);

    if (validation.decision === "reject") {
      const auditId = `skill-optimization-rejected:${options.skillName}:${cycle}`;
      if (!options.dryRun) {
        writeAuditRecord(
          options.runtime,
          mapSkillOptimizationRejectedToEntityRecord({
            recordId: auditId,
            skillName: options.skillName,
            validation,
            proposed,
            cycle,
            projectRef: options.projectRef,
            occurredAt: syncedAt,
            recordedAt: syncedAt,
          })
        );
      }

      rejectedBodyEdits.add(proposed.bodyAfter);

      outcomes.push({
        skillName: options.skillName,
        proposed: true,
        accepted: false,
        cyclesRun: cycle,
        finalScore: currentScore,
        reject_reason: validation.reject_reason,
        auditRecordId: auditId,
      });
      continue;
    }

    if (options.dryRun) {
      outcomes.push({
        skillName: options.skillName,
        proposed: true,
        accepted: false,
        cyclesRun: cycle,
        finalScore: currentScore,
      });
      continue;
    }

    const versionBefore = current.frontmatter.version;
    const versionAfter = bumpPatchVersion(versionBefore);
    const scoreDelta = validation.scoreAfter - validation.scoreBefore;
    const updated = withOptimizerProvenance(
      parseCanonicalProcedure({
        ...candidate,
        frontmatter: {
          ...candidate.frontmatter,
          version: versionAfter,
        },
      }),
      cycle,
      scoreDelta,
      proposed.budgetUsed.linesChanged,
      budget.max_lines_changed,
      syncedAt
    );

    const previousProcedure = options.registry.get(options.skillName)?.procedure;
    options.registry.update(options.skillName, updated);
    current = updated;
    acceptedCount += 1;

    if (options.writers) {
      const propagation = await propagateProcedures({
        registry: options.registry,
        writers: options.writers,
        syncedAt,
      });
      if (propagation.writes.some((record) => record.status === "failed")) {
        // Keep the accept atomic: roll the registry back to its pre-accept state so
        // a propagation failure never leaves a bumped-but-unpropagated entry.
        if (previousProcedure) {
          options.registry.update(options.skillName, previousProcedure);
        }
        current = previousProcedure ?? candidate;
        acceptedCount -= 1;
        return {
          ok: false,
          outcomes,
          proposedCount,
          acceptedCount,
          silent: false,
          error: "Propagation failed after optimization accept.",
        };
      }
    }

    const auditId = `skill-optimized:${options.skillName}:${cycle}`;
    writeAuditRecord(
      options.runtime,
      mapSkillOptimizedToEntityRecord({
        recordId: auditId,
        skillName: options.skillName,
        versionBefore,
        versionAfter,
        validation,
        proposed,
        cycle,
        projectRef: options.projectRef,
        occurredAt: syncedAt,
        recordedAt: syncedAt,
      })
    );

    outcomes.push({
      skillName: options.skillName,
      proposed: true,
      accepted: true,
      cyclesRun: cycle,
      finalScore: validation.scoreAfter,
      auditRecordId: auditId,
    });

    if (validation.scoreAfter >= scoreThreshold) {
      break;
    }
  }

  return {
    ok: true,
    outcomes,
    proposedCount,
    acceptedCount,
    silent: proposedCount === 0,
  };
}

/** List all skills referenced by correction corpus entries. */
export function listSkillsWithCorpusEntries(
  records: readonly RuntimeSemanticEntityRecord[]
): string[] {
  const names = new Set<string>();
  for (const record of records) {
    if (record.kind !== "episodic-frame") {
      continue;
    }
    const frame = parseEpisodicFrame(record.payload);
    const skillName = frame.details?.skill_name;
    if (typeof skillName === "string" && skillName.length > 0) {
      names.add(skillName);
    }
  }
  return [...names].sort();
}
