/**
 * `amp consolidate` — drain runtime queue into the configured knowledge backend.
 *
 * Falsifiable claim: in-memory mode uses consolidateNow; gbrain/fake-gbrain use
 * consolidateToGbrain with durable remove-after-write semantics.
 */

import { consolidateToGbrain } from "../substrate/consolidation/gbrain-consolidation.js";
import {
  consolidateNow,
  type ConsolidationResult,
} from "../substrate/storage/consolidation-minimal.js";
import { openRuntimeStore, resolveCliProjectContext } from "./cli-context.js";
import {
  createKnowledgeBackend,
  resolveKnowledgeBackend,
  type AmpKnowledgeBackend,
} from "./knowledge-backend.js";

export interface AmpConsolidateOptions {
  projectRoot?: string;
  knowledge?: string;
  useLiveGbrain?: boolean;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: () => string;
  ampRepoRoot?: string;
  /** Inject in-memory store for tests. */
  inMemoryStore?: import("../adapters/ssa/in-memory-knowledge-store.js").InMemoryKnowledgeStore;
  gbrainAdapter?: import("../adapters/ssa/gbrain/adapter.js").GbrainKnowledgeAdapter;
}

export interface AmpConsolidateResult extends ConsolidationResult {
  projectRoot: string;
  runtimeDbPath: string;
  knowledgeBackend: AmpKnowledgeBackend;
  liveGbrain?: boolean;
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

  const knowledgeBackend = resolveKnowledgeBackend({
    explicit: options.knowledge,
    env: options.env,
  });

  const handle = createKnowledgeBackend({
    backend: knowledgeBackend,
    ampRepoRoot: options.ampRepoRoot,
    inMemoryStore: options.inMemoryStore,
    gbrainAdapter: options.gbrainAdapter,
    useLiveGbrain: options.useLiveGbrain,
  });

  const runtime = openRuntimeStore(context.runtimeDbPath);
  try {
    let consolidation: ConsolidationResult;

    if (handle.backend === "in-memory") {
      consolidation = consolidateNow(runtime, handle.inMemory!);
    } else {
      consolidation = await consolidateToGbrain(runtime, handle.gbrain!);
    }

    return {
      ...consolidation,
      projectRoot: context.projectRoot,
      runtimeDbPath: context.runtimeDbPath,
      knowledgeBackend: handle.backend,
      liveGbrain: handle.liveGbrain,
    };
  } finally {
    runtime.close();
  }
}

/** Human-readable consolidate output lines for CLI and tests. */
export function formatAmpConsolidateMessages(result: AmpConsolidateResult): string[] {
  const lines = [
    `Consolidated ${result.processed} signal(s) via ${result.knowledgeBackend}.`,
    `  runtime_db: ${result.runtimeDbPath}`,
  ];

  if (result.liveGbrain) {
    lines.push("  PROVISIONAL: live gbrain transport — not conformance-tested in CI.");
  }

  if (result.frameIds.length > 0) {
    lines.push(`  frame_ids: ${result.frameIds.join(", ")}`);
  }

  lines.push("");
  lines.push("Next step: run `amp retrieve` to read consolidated preferences.");

  return lines;
}
