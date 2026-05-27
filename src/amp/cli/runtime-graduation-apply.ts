/**
 * `amp runtime graduation apply` — explicit preference-candidate graduation (RUNTIME-GRAD-03).
 *
 * Falsifiable claim: one operator-confirmed runtime-preference-candidate decision
 * writes one semantic frame to an injected or persistent KnowledgeStore without RuntimeStore mutation.
 *
 * Boundary ownership:
 * - runtime-graduation-apply (this module): CLI orchestration and reporting.
 * - RuntimeStoreSemanticEntityReader: storage read boundary.
 * - planRuntimeGraduation + applyRuntimeGraduationDecision: graduation policy and apply.
 * - resolveGraduationApplyKnowledgeStore: fail-closed durable knowledge boundary (no gbrain).
 */

import { resolve } from "node:path";

import type { KnowledgeStore } from "../substrate/storage/knowledge-store.js";
import {
  applyRuntimeGraduationDecision,
} from "../runtime-semantics/graduation-apply.js";
import {
  planRuntimeGraduation,
  type RuntimeGraduationDecision,
} from "../runtime-semantics/graduation-planner.js";
import {
  RuntimeStoreSemanticEntityReader,
  type RuntimeSemanticEntityReader,
} from "../runtime-semantics/storage-source.js";
import type { RuntimeStore } from "../substrate/storage/runtime-store.js";
import {
  resolveGraduationApplyKnowledgeStore,
  type ResolveGraduationApplyKnowledgeStoreFailureReason,
} from "./knowledge-backend.js";
import {
  appendRuntimeCliErrorBlock,
  appendRuntimeDbPathLine,
  formatRuntimeCliJson,
} from "./runtime-cli-report.js";
import {
  resolveAmpRuntimeCliBootstrap,
  withAmpRuntimeCliStore,
} from "./runtime-cli-bootstrap.js";

export interface AmpRuntimeGraduationApplyOptions {
  projectRoot?: string;
  id: string;
  generatedAt?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: () => string;
  deps?: {
    openRuntimeStore?: (dbPath: string) => RuntimeStore;
    createReader?: (runtime: RuntimeStore) => RuntimeSemanticEntityReader;
    knowledgeStore?: KnowledgeStore;
  };
}

export type AmpRuntimeGraduationApplyFailureReason =
  ResolveGraduationApplyKnowledgeStoreFailureReason;

export interface AmpRuntimeGraduationApplyResult {
  projectRoot: string;
  runtimeDbPath?: string;
  recordId: string;
  storageWired: boolean;
  ok: boolean;
  appliedFrameId?: string;
  decision?: RuntimeGraduationDecision;
  runtimeRowMutated: false;
  persistentLocalKnowledgeWritten?: boolean;
  reason?: AmpRuntimeGraduationApplyFailureReason;
  error?: string;
}

function formatGraduationDecisionSummary(decision: RuntimeGraduationDecision): string {
  switch (decision.status) {
    case "graduate":
      return `${decision.status} ${decision.runtimeKind} ${decision.reason}`;
    case "defer":
      return `${decision.status} ${decision.runtimeKind} ${decision.reason}`;
    case "proposal_required":
      return `${decision.status} ${decision.runtimeKind} ${decision.reason}`;
    case "skip":
      return `${decision.status} ${decision.runtimeKind} ${decision.reason}`;
    default: {
      const _exhaustive: never = decision;
      void _exhaustive;
      return "unknown";
    }
  }
}

/** Apply one graduate runtime-preference-candidate decision to local knowledge storage. */
export function runAmpRuntimeGraduationApply(
  options: AmpRuntimeGraduationApplyOptions,
): AmpRuntimeGraduationApplyResult {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const env = options.env ?? process.env;
  const recordId = options.id.trim();

  if (!recordId) {
    return {
      projectRoot,
      recordId: options.id,
      storageWired: false,
      ok: false,
      runtimeRowMutated: false,
      error: "Missing required --id runtime record id.",
    };
  }

  const bootstrap = resolveAmpRuntimeCliBootstrap({
    projectRoot: options.projectRoot,
    env,
    platform: options.platform,
    homedir: options.homedir,
  });
  if (!bootstrap.ok) {
    return {
      projectRoot: bootstrap.projectRoot,
      recordId,
      storageWired: false,
      ok: false,
      runtimeRowMutated: false,
      error: bootstrap.error,
    };
  }

  const knowledgeResult = resolveGraduationApplyKnowledgeStore({
    knowledgeStore: options.deps?.knowledgeStore,
    runtimeDbPath: bootstrap.runtimeDbPath,
  });
  if (!knowledgeResult.ok) {
    return {
      projectRoot: bootstrap.projectRoot,
      runtimeDbPath: bootstrap.runtimeDbPath,
      recordId,
      storageWired: false,
      ok: false,
      runtimeRowMutated: false,
      reason: knowledgeResult.reason,
      error: knowledgeResult.error,
    };
  }

  const usingPersistentLocalKnowledge = options.deps?.knowledgeStore === undefined;

  try {
    const createReader =
      options.deps?.createReader ??
      ((runtime: RuntimeStore) => new RuntimeStoreSemanticEntityReader(runtime));
    const generatedAt = options.generatedAt ?? new Date().toISOString();

    const applyResult = withAmpRuntimeCliStore(
      bootstrap,
      { deps: { openRuntimeStore: options.deps?.openRuntimeStore } },
      (runtime) => {
        const persisted = createReader(runtime).readEntities();
        const record = persisted.find((entity) => entity.id === recordId);
        if (record === undefined) {
          return {
            ok: false as const,
            recordId,
            reason: "record_not_found" as const,
            error: `Runtime semantic entity "${recordId}" was not found in typed runtime storage.`,
          };
        }

        const plan = planRuntimeGraduation({
          records: [record],
          generatedAt,
          projectRef: bootstrap.projectRef,
        });

        return applyRuntimeGraduationDecision({
          recordId,
          plan,
          knowledgeStore: knowledgeResult.store,
        });
      },
    );

    if (!applyResult.ok) {
      return {
        projectRoot: bootstrap.projectRoot,
        runtimeDbPath: bootstrap.runtimeDbPath,
        recordId,
        storageWired: true,
        ok: false,
        runtimeRowMutated: false,
        decision: "decision" in applyResult ? applyResult.decision : undefined,
        error: applyResult.error,
      };
    }

    return {
      projectRoot: bootstrap.projectRoot,
      runtimeDbPath: bootstrap.runtimeDbPath,
      recordId,
      storageWired: true,
      ok: true,
      appliedFrameId: applyResult.appliedFrameId,
      decision: applyResult.decision,
      runtimeRowMutated: false,
      persistentLocalKnowledgeWritten: usingPersistentLocalKnowledge,
    };
  } finally {
    knowledgeResult.cleanup();
  }
}

/** Human-readable graduation apply report lines for CLI and tests. */
export function formatAmpRuntimeGraduationApplyReport(
  result: AmpRuntimeGraduationApplyResult,
): string[] {
  const lines = [
    `AMP runtime graduation apply (experimental operator command) — ${result.projectRoot}`,
    "",
    `  target_id: ${result.recordId}`,
  ];

  if (result.error) {
    if (result.reason) {
      lines.push(`  reason: ${result.reason}`);
    }
    return appendRuntimeCliErrorBlock(
      lines,
      result.error,
      "ERROR Runtime graduation apply did not complete.",
    );
  }

  appendRuntimeDbPathLine(lines, result.runtimeDbPath);

  if (result.decision) {
    lines.push(`  decision: ${formatGraduationDecisionSummary(result.decision)}`);
  }

  if (result.appliedFrameId) {
    lines.push(`  durable_frame_id: ${result.appliedFrameId}`);
  }

  lines.push("");
  if (result.persistentLocalKnowledgeWritten) {
    lines.push(
      "NOTE Runtime semantic entity row was not mutated; durable local knowledge was written.",
    );
  } else {
    lines.push(
      "NOTE Runtime semantic entity row was not mutated; only durable knowledge was written.",
    );
  }
  lines.push("");
  lines.push("OK Runtime graduation apply finished.");

  return lines;
}

/** JSON payload for `amp runtime graduation apply --json`. */
export function formatAmpRuntimeGraduationApplyJson(
  result: AmpRuntimeGraduationApplyResult,
): string {
  return formatRuntimeCliJson({
    ok: result.ok,
    projectRoot: result.projectRoot,
    runtimeDbPath: result.runtimeDbPath ?? null,
    recordId: result.recordId,
    appliedFrameId: result.appliedFrameId ?? null,
    decision: result.decision ?? null,
    reason: result.reason ?? null,
    error: result.error ?? null,
  });
}
