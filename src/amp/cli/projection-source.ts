/**
 * Projection source factory for CLI materialization.
 *
 * Falsifiable claim: local and placeholder sources are created with explicit
 * runtime cleanup; test deps stay off public render options.
 */

import type { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import {
  LocalProjectionSource,
  materializeProjections,
  PlaceholderProjectionSource,
  type ProjectionMaterializationOptions,
  type ProjectionMaterializationPlan,
  type ProjectionSource,
} from "../projection/index.js";
import type { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { openRuntimeStore } from "./cli-context.js";
import { resolveProjectionKnowledgeStore } from "./knowledge-backend.js";

export type AmpProjectionSourceKind = "placeholder" | "local";

export interface ProjectionSourceFactoryDeps {
  openRuntimeStore?: (dbPath: string) => RuntimeStore;
  materializeProjections?: typeof materializeProjections;
}

export type ResolvedProjectionRenderSource =
  | { error: string }
  | { source: ProjectionSource; cleanup: () => void };

export interface CreateProjectionRenderSourceOptions {
  sourceKind: AmpProjectionSourceKind;
  projectRef?: string;
  runtimeDbPath: string;
  knowledgeStore?: InMemoryKnowledgeStore;
  env?: NodeJS.ProcessEnv;
  deps?: ProjectionSourceFactoryDeps;
}

/** Create a projection source and runtime cleanup callback for materialization. */
export function createProjectionRenderSource(
  options: CreateProjectionRenderSourceOptions
): ResolvedProjectionRenderSource {
  const { sourceKind, projectRef, runtimeDbPath, knowledgeStore, env, deps } = options;

  if (sourceKind === "placeholder") {
    return {
      source: new PlaceholderProjectionSource({ projectRef }),
      cleanup: () => {},
    };
  }

  const knowledgeResult = resolveProjectionKnowledgeStore({
    env,
    knowledgeStore,
  });

  if (!knowledgeResult.ok) {
    return { error: knowledgeResult.error };
  }

  const openStore = deps?.openRuntimeStore ?? openRuntimeStore;
  const runtime = openStore(runtimeDbPath);
  return {
    source: new LocalProjectionSource({
      knowledge: knowledgeResult.store,
      runtime,
      projectRef,
    }),
    cleanup: () => {
      runtime.close();
    },
  };
}

/** Run materialization with guaranteed source cleanup (success or throw). */
export async function materializeProjectionRenderSource(
  resolved: Extract<ResolvedProjectionRenderSource, { source: ProjectionSource }>,
  materializationOptions: ProjectionMaterializationOptions,
  deps: ProjectionSourceFactoryDeps = {}
): Promise<ProjectionMaterializationPlan> {
  const materialize = deps.materializeProjections ?? materializeProjections;
  try {
    return await materialize(resolved.source, materializationOptions);
  } finally {
    resolved.cleanup();
  }
}
