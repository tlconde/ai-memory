/**
 * Knowledge backend selection for AMP CLI consolidate/retrieve commands.
 *
 * Config schema has runtime only — backend is selected via CLI flags or
 * AMP_KNOWLEDGE_BACKEND env for v1.
 */

import { join } from "node:path";

import { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";
import { FakeGbrainMcpTransport } from "../adapters/ssa/gbrain/fake-transport.js";
import { InMemoryKnowledgeStore } from "../adapters/ssa/in-memory-knowledge-store.js";
import { resolveAmpRepoRoot } from "./doctor.js";

export const AMP_KNOWLEDGE_BACKEND_ENV = "AMP_KNOWLEDGE_BACKEND";

export type AmpKnowledgeBackend = "in-memory" | "gbrain" | "fake-gbrain";

const VALID_BACKENDS: AmpKnowledgeBackend[] = ["in-memory", "gbrain", "fake-gbrain"];

export interface ResolveKnowledgeBackendOptions {
  explicit?: string;
  env?: NodeJS.ProcessEnv;
}

/** Resolve knowledge backend from CLI flag or AMP_KNOWLEDGE_BACKEND env. */
export function resolveKnowledgeBackend(
  options: ResolveKnowledgeBackendOptions = {}
): AmpKnowledgeBackend {
  const env = options.env ?? process.env;
  const candidate = options.explicit?.trim() || env[AMP_KNOWLEDGE_BACKEND_ENV]?.trim();

  if (candidate) {
    if (!VALID_BACKENDS.includes(candidate as AmpKnowledgeBackend)) {
      throw new Error(
        `Invalid knowledge backend "${candidate}" — expected one of: ${VALID_BACKENDS.join(", ")}`
      );
    }
    return candidate as AmpKnowledgeBackend;
  }

  return "gbrain";
}

export interface KnowledgeBackendHandle {
  backend: AmpKnowledgeBackend;
  inMemory?: InMemoryKnowledgeStore;
  gbrain?: GbrainKnowledgeAdapter;
  /** True when live gbrain serve transport is in use (PROVISIONAL). */
  liveGbrain?: boolean;
}

export interface CreateKnowledgeBackendOptions {
  backend: AmpKnowledgeBackend;
  ampRepoRoot?: string;
  /** Inject in-memory store for tests (consolidate + retrieve in one process). */
  inMemoryStore?: InMemoryKnowledgeStore;
  /** Inject gbrain adapter for tests. */
  gbrainAdapter?: GbrainKnowledgeAdapter;
  /** Opt in to live `gbrain serve` when backend is gbrain (PROVISIONAL). */
  useLiveGbrain?: boolean;
}

/** Create or inject a knowledge backend handle for consolidate/retrieve. */
export function createKnowledgeBackend(
  options: CreateKnowledgeBackendOptions
): KnowledgeBackendHandle {
  if (options.backend === "in-memory") {
    return {
      backend: "in-memory",
      inMemory: options.inMemoryStore ?? new InMemoryKnowledgeStore(),
    };
  }

  if (options.gbrainAdapter) {
    return {
      backend: options.backend,
      gbrain: options.gbrainAdapter,
      liveGbrain: false,
    };
  }

  const ampRepoRoot = resolveAmpRepoRoot(options.ampRepoRoot);
  const ssaSpecPath = join(ampRepoRoot, "ssa-files", "gbrain.yaml");

  if (options.backend === "fake-gbrain") {
    return {
      backend: "fake-gbrain",
      gbrain: new GbrainKnowledgeAdapter({
        transport: new FakeGbrainMcpTransport(),
        ssaSpecPath,
      }),
      liveGbrain: false,
    };
  }

  const useLiveGbrain = options.useLiveGbrain === true;
  return {
    backend: "gbrain",
    gbrain: new GbrainKnowledgeAdapter({
      ssaSpecPath,
      useLiveTransport: useLiveGbrain,
    }),
    liveGbrain: useLiveGbrain,
  };
}
