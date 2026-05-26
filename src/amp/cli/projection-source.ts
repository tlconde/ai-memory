/**
 * Projection source factory for CLI materialization.
 *
 * Falsifiable claim: local, gbrain, and placeholder sources are created with explicit
 * runtime cleanup; gbrain uses readonly transport + optional preflight.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";
import { FakeGbrainMcpTransport } from "../adapters/ssa/gbrain/fake-transport.js";
import { ReadonlyGbrainMcpTransport } from "../adapters/ssa/gbrain/readonly-transport.js";
import { GbrainServeStdioTransport } from "../adapters/ssa/gbrain/transport.js";
import type { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import {
  GbrainProjectionSource,
  LocalProjectionSource,
  materializeProjections,
  PlaceholderProjectionSource,
  type ProjectionMaterializationOptions,
  type ProjectionMaterializationPlan,
  type ProjectionSource,
} from "../projection/index.js";
import type { RuntimeSemanticEntitySource } from "../runtime-semantics/projection-source.js";
import {
  RuntimeSemanticStorageEntitySource,
  RuntimeStoreSemanticEntityReader,
} from "../runtime-semantics/storage-source.js";
import type { RuntimeStore } from "../substrate/storage/runtime-store.js";
import {
  collectGbrainPreflightChecks,
  type GbrainPreflightSpawnFn,
} from "./checks/gbrain-preflight.js";
import { openRuntimeStore } from "./cli-context.js";
import { resolveAmpRepoRoot } from "./doctor.js";
import { resolveKnowledgeBackend, resolveProjectionKnowledgeStore } from "./knowledge-backend.js";

export type AmpProjectionSourceKind = "placeholder" | "local" | "gbrain";

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
  gbrainAdapter?: GbrainKnowledgeAdapter;
  env?: NodeJS.ProcessEnv;
  ampRepoRoot?: string;
  /** When false, skip collectGbrainPreflightChecks (tests / opt-in live harness). */
  strictGbrainPreflight?: boolean;
  spawnFn?: GbrainPreflightSpawnFn;
  deps?: ProjectionSourceFactoryDeps;
  /**
   * Optional override for local typed runtime semantics. When omitted, the factory
   * wires {@link RuntimeSemanticStorageEntitySource} with {@link RuntimeStoreSemanticEntityReader}
   * (reads `runtime_semantic_entity`; empty table yields queue-only typed output).
   */
  runtimeSemanticSource?: RuntimeSemanticEntitySource;
}

type ResolveGbrainProjectionAdapterResult =
  | { ok: true; adapter: GbrainKnowledgeAdapter }
  | { ok: false; error: string };

function formatPreflightErrors(
  findings: ReturnType<typeof collectGbrainPreflightChecks>["findings"]
): string {
  return findings
    .filter((item) => item.level === "error")
    .map((item) => item.message)
    .join(" ");
}

function resolveGbrainProjectionAdapter(
  options: CreateProjectionRenderSourceOptions
): ResolveGbrainProjectionAdapterResult {
  if (options.gbrainAdapter) {
    return { ok: true, adapter: options.gbrainAdapter };
  }

  const env = options.env ?? process.env;
  let backend;
  try {
    backend = resolveKnowledgeBackend({ env });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, error: message };
  }

  const skipPreflight =
    options.strictGbrainPreflight === false || backend === "fake-gbrain";

  if (!skipPreflight) {
    const checks = collectGbrainPreflightChecks({
      env,
      spawnFn: options.spawnFn ?? spawnSync,
    });
    if (!checks.ok) {
      return {
        ok: false,
        error: formatPreflightErrors(checks.findings) || "Gbrain preflight failed.",
      };
    }
  }

  const ampRepoRoot = options.ampRepoRoot ?? resolveAmpRepoRoot();
  const ssaSpecPath = join(ampRepoRoot, "ssa-files", "gbrain.yaml");

  try {
    const inner =
      backend === "fake-gbrain"
        ? new FakeGbrainMcpTransport()
        : new GbrainServeStdioTransport();
    const adapter = new GbrainKnowledgeAdapter({
      transport: new ReadonlyGbrainMcpTransport(inner),
      ssaSpecPath,
    });
    return { ok: true, adapter };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, error: message };
  }
}

function resolveLocalRuntimeSemanticSource(
  runtime: RuntimeStore,
  override?: RuntimeSemanticEntitySource
): RuntimeSemanticEntitySource {
  return (
    override ??
    new RuntimeSemanticStorageEntitySource(new RuntimeStoreSemanticEntityReader(runtime))
  );
}

function createRuntimeBackedProjectionSource<T extends ProjectionSource>(
  runtimeDbPath: string,
  openStore: (dbPath: string) => RuntimeStore,
  createSource: (runtime: RuntimeStore) => T
): { source: T; cleanup: () => void } {
  const runtime = openStore(runtimeDbPath);
  return {
    source: createSource(runtime),
    cleanup: () => {
      runtime.close();
    },
  };
}

/** Create a projection source and runtime cleanup callback for materialization. */
export function createProjectionRenderSource(
  options: CreateProjectionRenderSourceOptions
): ResolvedProjectionRenderSource {
  const { sourceKind, projectRef, runtimeDbPath, knowledgeStore, env, deps, runtimeSemanticSource } =
    options;
  const openStore = deps?.openRuntimeStore ?? openRuntimeStore;

  if (sourceKind === "placeholder") {
    return {
      source: new PlaceholderProjectionSource({ projectRef }),
      cleanup: () => {},
    };
  }

  if (sourceKind === "gbrain") {
    const gbrainResult = resolveGbrainProjectionAdapter(options);
    if (!gbrainResult.ok) {
      return { error: gbrainResult.error };
    }

    return createRuntimeBackedProjectionSource(
      runtimeDbPath,
      openStore,
      (runtime) =>
        new GbrainProjectionSource({
          adapter: gbrainResult.adapter,
          runtime,
          projectRef,
        })
    );
  }

  const knowledgeResult = resolveProjectionKnowledgeStore({
    env,
    knowledgeStore,
  });

  if (!knowledgeResult.ok) {
    return { error: knowledgeResult.error };
  }

  return createRuntimeBackedProjectionSource(
    runtimeDbPath,
    openStore,
    (runtime) =>
      new LocalProjectionSource({
        knowledge: knowledgeResult.store,
        runtime,
        projectRef,
        runtimeSemanticSource: resolveLocalRuntimeSemanticSource(runtime, runtimeSemanticSource),
      })
  );
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
