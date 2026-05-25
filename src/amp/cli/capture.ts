/**
 * `amp capture` — enqueue a preference signal in the runtime store.
 *
 * Falsifiable claim: capture writes to the configured runtime DB without touching
 * harness from-amp artifacts.
 */

import type { ScopeKind } from "../core/frame-schema.js";
import {
  capturePreference,
  type CapturePreferenceResult,
} from "../substrate/capture-preference.js";
import { openRuntimeStore, resolveCliProjectContext } from "./cli-context.js";

export interface AmpCaptureOptions {
  content: string;
  scope?: ScopeKind;
  projectRef?: string;
  projectRoot?: string;
  surface?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: () => string;
}

export interface AmpCaptureResult extends CapturePreferenceResult {
  projectRoot: string;
  runtimeDbPath: string;
  scope: ScopeKind;
  projectRef?: string;
}

/** Capture a preference into the runtime episodic queue. */
export function runAmpCapture(options: AmpCaptureOptions): AmpCaptureResult {
  const context = resolveCliProjectContext({
    projectRoot: options.projectRoot,
    env: options.env,
    platform: options.platform,
    homedir: options.homedir,
  });

  const scope = options.scope ?? "project";
  const projectRef =
    scope === "project" ? (options.projectRef ?? context.projectRef) : options.projectRef;

  const runtime = openRuntimeStore(context.runtimeDbPath);
  try {
    const result = capturePreference(runtime, {
      content: options.content,
      scope,
      projectRef,
      surface: options.surface,
    });

    return {
      ...result,
      projectRoot: context.projectRoot,
      runtimeDbPath: context.runtimeDbPath,
      scope,
      projectRef,
    };
  } finally {
    runtime.close();
  }
}

/** Human-readable capture output lines for CLI and tests. */
export function formatAmpCaptureMessages(result: AmpCaptureResult): string[] {
  const scopeLabel =
    result.scope === "project" && result.projectRef
      ? `${result.scope}:${result.projectRef}`
      : result.scope;

  return [
    `Captured preference (${scopeLabel}) → runtime queue.`,
    `  signal_id: ${result.signalId}`,
    `  runtime_db: ${result.runtimeDbPath}`,
    "",
    "Next step: run `amp consolidate` to move queued signals into knowledge storage.",
  ];
}
