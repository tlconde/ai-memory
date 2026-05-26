/**
 * Shared runtime CLI project/bootstrap helper (RUNTIME-19).
 *
 * Falsifiable claim: runtime seed/inspect commands resolve project config and
 * open/close RuntimeStore through one helper without duplicating bootstrap logic.
 *
 * Boundary ownership:
 * - runtime-cli-bootstrap (this module): config existence, context discovery, store lifecycle.
 * - runtime-seed / runtime-inspect: command-specific orchestration only.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { projectConfigPath } from "../config/paths.js";
import type { RuntimeStore } from "../substrate/storage/runtime-store.js";
import { openRuntimeStore, resolveCliProjectContext } from "./cli-context.js";

export interface AmpRuntimeCliBootstrapOptions {
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: () => string;
}

export interface AmpRuntimeCliStoreOptions {
  deps?: {
    openRuntimeStore?: (dbPath: string) => RuntimeStore;
  };
}

export interface AmpRuntimeCliBootstrapContext {
  projectRoot: string;
  runtimeDbPath: string;
  projectRef?: string;
}

export type AmpRuntimeCliBootstrapResult =
  | ({ ok: true } & AmpRuntimeCliBootstrapContext)
  | {
      ok: false;
      projectRoot: string;
      runtimeDbPath: string;
      error: string;
    };

/** Resolve runtime CLI project root, config, and runtime DB path without opening storage. */
export function resolveAmpRuntimeCliBootstrap(
  options: AmpRuntimeCliBootstrapOptions = {},
): AmpRuntimeCliBootstrapResult {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const env = options.env ?? process.env;

  const configPath = projectConfigPath(projectRoot, { env });
  if (!existsSync(configPath)) {
    return {
      ok: false,
      projectRoot,
      runtimeDbPath: "",
      error: `Project AMP config not found at ${configPath}. Run \`ai-memory amp init\` first.`,
    };
  }

  try {
    const context = resolveCliProjectContext({
      projectRoot,
      env,
      platform: options.platform,
      homedir: options.homedir,
    });
    return {
      ok: true,
      projectRoot: context.projectRoot,
      runtimeDbPath: context.runtimeDbPath,
      projectRef: context.projectRef,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      projectRoot,
      runtimeDbPath: "",
      error: `AMP config discovery failed: ${message}`,
    };
  }
}

/** Open RuntimeStore for a successful bootstrap and guarantee close after the callback. */
export function withAmpRuntimeCliStore<T>(
  bootstrap: AmpRuntimeCliBootstrapContext,
  options: AmpRuntimeCliStoreOptions = {},
  fn: (runtime: RuntimeStore, bootstrap: AmpRuntimeCliBootstrapContext) => T,
): T {
  const openStore = options.deps?.openRuntimeStore ?? openRuntimeStore;
  const runtime = openStore(bootstrap.runtimeDbPath);

  try {
    return fn(runtime, bootstrap);
  } finally {
    runtime.close();
  }
}
