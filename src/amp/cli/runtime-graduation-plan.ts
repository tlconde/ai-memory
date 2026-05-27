/**
 * `amp runtime graduation plan` — read-only graduation review (RUNTIME-GRAD-02).
 *
 * Falsifiable claim: typed runtime semantic entities loaded via
 * RuntimeStoreSemanticEntityReader are classified through planRuntimeGraduation
 * without RuntimeStore mutation, KnowledgeStore writes, or apply wiring.
 *
 * Boundary ownership:
 * - runtime-graduation-plan (this module): CLI orchestration and reporting.
 * - RuntimeStoreSemanticEntityReader: storage read boundary.
 * - planRuntimeGraduation: pure graduation policy.
 */

import { resolve } from "node:path";

import {
  planRuntimeGraduation,
  type RuntimeGraduationDecision,
  type RuntimeGraduationPlan,
} from "../runtime-semantics/graduation-planner.js";
import {
  RUNTIME_ENTITY_REGISTRY,
  type RuntimeEntityKind,
  type RuntimeEntitySchemaName,
  isRuntimeEntityKind,
  runtimeEntitySchemaNameForKind,
} from "../runtime-semantics/schema.js";
import {
  RuntimeStoreSemanticEntityReader,
  type RuntimeSemanticEntityReader,
} from "../runtime-semantics/storage-source.js";
import type { RuntimeStore } from "../substrate/storage/runtime-store.js";
import {
  appendRuntimeCliErrorBlock,
  appendRuntimeDbPathLine,
  formatRuntimeCliJson,
} from "./runtime-cli-report.js";
import {
  resolveAmpRuntimeCliBootstrap,
  withAmpRuntimeCliStore,
} from "./runtime-cli-bootstrap.js";

export interface AmpRuntimeGraduationPlanOptions {
  projectRoot?: string;
  entity?: string;
  generatedAt?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: () => string;
  deps?: {
    openRuntimeStore?: (dbPath: string) => RuntimeStore;
    createReader?: (runtime: RuntimeStore) => RuntimeSemanticEntityReader;
  };
}

export interface AmpRuntimeGraduationPlanResult {
  projectRoot: string;
  runtimeDbPath?: string;
  entity?: RuntimeEntityKind;
  entitySchemaName?: RuntimeEntitySchemaName;
  storageWired: boolean;
  ok: boolean;
  error?: string;
  plan?: RuntimeGraduationPlan;
}

function formatGraduationDecisionLine(decision: RuntimeGraduationDecision): string {
  switch (decision.status) {
    case "graduate":
      return `  GRADUATE ${decision.recordId} ${decision.runtimeKind} ${decision.reason}`;
    case "defer":
      return `  DEFER ${decision.recordId} ${decision.runtimeKind} ${decision.reason}`;
    case "proposal_required":
      return `  PROPOSAL ${decision.recordId} ${decision.runtimeKind} ${decision.reason}`;
    case "skip":
      return `  SKIP ${decision.recordId} ${decision.runtimeKind} ${decision.reason}`;
    default: {
      const _exhaustive: never = decision;
      void _exhaustive;
      return "";
    }
  }
}

/** Read persisted typed runtime entities and build a pure graduation plan. */
export function runAmpRuntimeGraduationPlan(
  options: AmpRuntimeGraduationPlanOptions = {},
): AmpRuntimeGraduationPlanResult {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const env = options.env ?? process.env;

  let entity: RuntimeEntityKind | undefined;
  if (options.entity !== undefined) {
    if (!isRuntimeEntityKind(options.entity)) {
      const expected = RUNTIME_ENTITY_REGISTRY.map((entry) => entry.kind).join(", ");
      return {
        projectRoot,
        storageWired: false,
        ok: false,
        error: `Invalid runtime entity kind "${options.entity}" — expected one of: ${expected}.`,
      };
    }
    entity = options.entity;
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
      storageWired: false,
      ok: false,
      error: bootstrap.error,
    };
  }

  const createReader =
    options.deps?.createReader ??
    ((runtime: RuntimeStore) => new RuntimeStoreSemanticEntityReader(runtime));

  const generatedAt = options.generatedAt ?? new Date().toISOString();

  const plan = withAmpRuntimeCliStore(
    bootstrap,
    { deps: { openRuntimeStore: options.deps?.openRuntimeStore } },
    (runtime) => {
      const persisted = createReader(runtime).readEntities();
      const filtered =
        entity === undefined
          ? persisted
          : persisted.filter((record) => record.kind === entity);

      return planRuntimeGraduation({
        records: filtered,
        generatedAt,
        projectRef: bootstrap.projectRef,
      });
    },
  );

  return {
    projectRoot: bootstrap.projectRoot,
    runtimeDbPath: bootstrap.runtimeDbPath,
    entity,
    entitySchemaName: entity ? runtimeEntitySchemaNameForKind(entity) : undefined,
    storageWired: true,
    ok: true,
    plan,
  };
}

/** Human-readable graduation plan report lines for CLI and tests. */
export function formatAmpRuntimeGraduationPlanReport(
  result: AmpRuntimeGraduationPlanResult,
): string[] {
  const lines = [
    `AMP runtime graduation plan (experimental operator command) — ${result.projectRoot}`,
    "",
  ];

  if (result.error) {
    return appendRuntimeCliErrorBlock(
      lines,
      result.error,
      "ERROR Runtime graduation plan did not run.",
    );
  }

  appendRuntimeDbPathLine(lines, result.runtimeDbPath);

  if (result.entity) {
    lines.push(`  filter: ${result.entity} (${result.entitySchemaName})`);
  }

  const plan = result.plan;
  if (plan === undefined) {
    lines.push("");
    lines.push("ERROR Runtime graduation plan did not produce a plan.");
    return lines;
  }

  lines.push(`  generated_at: ${plan.generatedAt}`);
  lines.push("");
  lines.push(
    `Summary: ${plan.summary.graduate} graduate, ${plan.summary.defer} defer, ${plan.summary.proposal_required} proposal, ${plan.summary.skip} skip`,
  );
  lines.push("");

  if (plan.decisions.length === 0) {
    lines.push("  (no persisted typed runtime semantic entities)");
  } else {
    for (const decision of plan.decisions) {
      lines.push(formatGraduationDecisionLine(decision));
    }
  }

  lines.push("");
  lines.push("OK Runtime graduation plan finished read-only; no state was mutated.");

  return lines;
}

/** JSON payload for `amp runtime graduation plan --json`. */
export function formatAmpRuntimeGraduationPlanJson(
  result: AmpRuntimeGraduationPlanResult,
): string {
  return formatRuntimeCliJson({
    ok: result.ok,
    projectRoot: result.projectRoot,
    runtimeDbPath: result.runtimeDbPath ?? null,
    entity: result.entity ?? null,
    entitySchemaName: result.entitySchemaName ?? null,
    storageWired: result.storageWired,
    error: result.error ?? null,
    plan: result.plan ?? null,
  });
}
