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
import { LOCAL_PROJECTION_KNOWLEDGE_UNAVAILABLE } from "../projection/messages.js";
import {
  assertLiveGbrainWriteConfirmed,
  type KnowledgeBackendAccess,
} from "../gbrain/live-policy.js";
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
  /** read: live gbrain allowed; write: requires live write confirmation unless adapter injected. */
  access?: KnowledgeBackendAccess;
  confirmLiveGbrainWrite?: boolean;
  env?: NodeJS.ProcessEnv;
  ampRepoRoot?: string;
  /** Inject in-memory store for tests (consolidate + retrieve in one process). */
  inMemoryStore?: InMemoryKnowledgeStore;
  /** Inject gbrain adapter for tests — bypasses live write confirmation. */
  gbrainAdapter?: GbrainKnowledgeAdapter;
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

  const access = options.access ?? "read";
  if (access === "write") {
    assertLiveGbrainWriteConfirmed({
      confirmLiveGbrainWrite: options.confirmLiveGbrainWrite,
      env: options.env,
    });
  }

  return {
    backend: "gbrain",
    gbrain: new GbrainKnowledgeAdapter({
      ssaSpecPath,
      useLiveTransport: true,
    }),
    liveGbrain: true,
  };
}

/** Create a read-only knowledge backend handle (live gbrain reads allowed). */
export function createReadKnowledgeBackend(
  options: Omit<CreateKnowledgeBackendOptions, "access">
): KnowledgeBackendHandle {
  return createKnowledgeBackend({ ...options, access: "read" });
}

/** Create a mutating knowledge backend handle (live gbrain writes require confirmation). */
export function createWriteKnowledgeBackend(
  options: Omit<CreateKnowledgeBackendOptions, "access">
): KnowledgeBackendHandle {
  return createKnowledgeBackend({ ...options, access: "write" });
}

export interface ResolveProjectionKnowledgeStoreOptions {
  env?: NodeJS.ProcessEnv;
  knowledgeStore?: InMemoryKnowledgeStore;
}

export type ResolveProjectionKnowledgeStoreResult =
  | { ok: true; store: InMemoryKnowledgeStore }
  | { ok: false; error: string };

/** Resolve offline knowledge for local projection source — never live gbrain. */
export function resolveProjectionKnowledgeStore(
  options: ResolveProjectionKnowledgeStoreOptions = {}
): ResolveProjectionKnowledgeStoreResult {
  if (options.knowledgeStore) {
    return { ok: true, store: options.knowledgeStore };
  }

  const backend = resolveKnowledgeBackend({ env: options.env });
  if (backend !== "in-memory") {
    return { ok: false, error: LOCAL_PROJECTION_KNOWLEDGE_UNAVAILABLE };
  }

  const handle = createReadKnowledgeBackend({
    backend: "in-memory",
    env: options.env,
  });

  if (!handle.inMemory) {
    return { ok: false, error: LOCAL_PROJECTION_KNOWLEDGE_UNAVAILABLE };
  }

  return { ok: true, store: handle.inMemory };
}
