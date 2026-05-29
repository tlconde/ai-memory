/**
 * `amp consolidate` — drain runtime queue into the configured knowledge backend.
 *
 * Falsifiable claim: default path uses consolidateNow against persistent knowledge.db;
 * explicit in-memory uses consolidateNow; gbrain/fake-gbrain use consolidateToGbrain
 * with durable remove-after-write semantics.
 */

import { consolidateToGbrain } from "../substrate/consolidation/gbrain-consolidation.js";
import { consolidateNow } from "../substrate/storage/consolidation-minimal.js";
import type { KnowledgeStore } from "../substrate/storage/knowledge-store.js";
import type { ConsolidationResult } from "../substrate/consolidation/types.js";
import { openRuntimeStore, resolveCliProjectContext } from "./cli-context.js";
import {
  resolveConsolidateKnowledgeStore,
  type AmpConsolidateKnowledgeBackend,
  type AmpConsolidateKnowledgeSource,
} from "./knowledge-backend.js";

export type { AmpConsolidateKnowledgeBackend, AmpConsolidateKnowledgeSource };

export interface AmpConsolidateOptions {
  projectRoot?: string;
  knowledge?: string;
  confirmLiveGbrainWrite?: boolean;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: () => string;
  ampRepoRoot?: string;
  /** Inject in-memory store for tests. */
  inMemoryStore?: import("../adapters/ssa/in-memory-knowledge-store.js").InMemoryKnowledgeStore;
  /** Inject knowledge store for tests/DI (wins when no explicit backend). */
  knowledgeStore?: KnowledgeStore;
  gbrainAdapter?: import("../adapters/ssa/gbrain/adapter.js").GbrainKnowledgeAdapter;
}

export interface AmpConsolidateResult extends ConsolidationResult {
  projectRoot: string;
  runtimeDbPath: string;
  knowledgeBackend: AmpConsolidateKnowledgeBackend;
  knowledgeSource: AmpConsolidateKnowledgeSource;
  liveGbrain?: boolean;
}

/** Human-readable label for where consolidation wrote frames. */
export function formatConsolidateKnowledgeSourceLabel(result: AmpConsolidateResult): string {
  switch (result.knowledgeSource) {
    case "in-memory":
      return "in-memory";
    case "gbrain":
      return result.knowledgeBackend;
    case "injected":
      return "injected knowledge store";
    case "local-sqlite":
      return "local persistent knowledge.db";
  }
}

/** Consolidate queued runtime signals into knowledge storage. */
export async function runAmpConsolidate(
  options: AmpConsolidateOptions = {}
): Promise<AmpConsolidateResult> {
  const context = resolveCliProjectContext({
    projectRoot: options.projectRoot,
    env: options.env,
    platform: options.platform,
    homedir: options.homedir,
  });

  const resolved = resolveConsolidateKnowledgeStore({
    explicitKnowledge: options.knowledge,
    env: options.env,
    runtimeDbPath: context.runtimeDbPath,
    inMemoryStore: options.inMemoryStore,
    knowledgeStore: options.knowledgeStore,
    gbrainAdapter: options.gbrainAdapter,
    ampRepoRoot: options.ampRepoRoot,
    confirmLiveGbrainWrite: options.confirmLiveGbrainWrite,
  });

  if (!resolved.ok) {
    throw new Error(resolved.error);
  }

  const runtime = openRuntimeStore(context.runtimeDbPath);
  try {
    let consolidation: ConsolidationResult;

    switch (resolved.backend) {
      case "in-memory":
      case "local-persistent":
        consolidation = consolidateNow(runtime, resolved.store);
        break;
      case "gbrain":
      case "fake-gbrain":
        consolidation = await consolidateToGbrain(runtime, resolved.gbrain);
        break;
    }

    return {
      ...consolidation,
      projectRoot: context.projectRoot,
      runtimeDbPath: context.runtimeDbPath,
      knowledgeBackend: resolved.backend,
      knowledgeSource: resolved.source,
      liveGbrain: resolved.liveGbrain,
    };
  } finally {
    runtime.close();
    resolved.cleanup();
  }
}

/** Human-readable consolidate output lines for CLI and tests. */
export function formatAmpConsolidateMessages(result: AmpConsolidateResult): string[] {
  const backendLabel = formatConsolidateKnowledgeSourceLabel(result);
  const lines = [
    `Consolidated ${result.processed} signal(s) via ${backendLabel}.`,
    `  runtime_db: ${result.runtimeDbPath}`,
  ];

  if (result.liveGbrain) {
    lines.push("  PROVISIONAL: live gbrain write — not conformance-tested in CI.");
  }

  if (result.frameIds.length > 0) {
    lines.push(`  frame_ids: ${result.frameIds.join(", ")}`);
  }

  lines.push("");
  lines.push("Next step: run `amp retrieve` to read consolidated preferences.");

  return lines;
}
