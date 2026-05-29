/**
 * Shared offline durable-local capture → consolidate → retrieve → projection loop.
 *
 * Falsifiable claim: one orchestrator drives capture/consolidate/retrieve/projection
 * dry-run against persistent knowledge.db without gbrain or assertions in-callers.
 */

import type { ScopeKind } from "../../core/frame-schema.js";
import { runAmpCapture, type AmpCaptureResult } from "../../cli/capture.js";
import { runAmpConsolidate, type AmpConsolidateResult } from "../../cli/consolidate.js";
import { openRuntimeStore, resolveCliProjectContext } from "../../cli/cli-context.js";
import { runAmpProjectionRender, type AmpProjectionRenderResult } from "../../cli/projection.js";
import { createProjectionRenderSource } from "../../cli/projection-source.js";
import { runAmpRetrieve, type AmpRetrieveResult } from "../../cli/retrieve.js";

export interface RunDurableLocalCaptureLoopOptions {
  projectRoot: string;
  env?: NodeJS.ProcessEnv;
  captureContent: string;
  captureScope?: ScopeKind;
  captureProjectRef?: string;
  retrieveQuery: string;
  homedir?: () => string;
}

export interface DurableLocalCaptureLoopResult {
  captureResult: AmpCaptureResult;
  consolidateResult: AmpConsolidateResult;
  retrieveResult: AmpRetrieveResult;
  projectionDryRunResult: AmpProjectionRenderResult;
  queueDrained: boolean;
  retrievedFrameId?: string;
  projectionBodyContainsCapturedContent: boolean;
}

/** Run the offline durable-local capture loop and return structured step outcomes. */
export async function runDurableLocalCaptureLoop(
  options: RunDurableLocalCaptureLoopOptions,
): Promise<DurableLocalCaptureLoopResult> {
  const captureScope = options.captureScope ?? "project";
  const homedir = options.homedir;

  const captureResult = runAmpCapture({
    projectRoot: options.projectRoot,
    content: options.captureContent,
    scope: captureScope,
    projectRef: options.captureProjectRef,
    env: options.env,
    homedir,
  });

  const consolidateResult = await runAmpConsolidate({
    projectRoot: options.projectRoot,
    env: options.env,
    homedir,
  });

  const context = resolveCliProjectContext({
    projectRoot: options.projectRoot,
    env: options.env,
    homedir,
  });

  const runtimeAfterConsolidate = openRuntimeStore(context.runtimeDbPath);
  let queueDrained = false;
  try {
    queueDrained = runtimeAfterConsolidate.queueList().length === 0;
  } finally {
    runtimeAfterConsolidate.close();
  }

  const retrieveResult = await runAmpRetrieve({
    projectRoot: options.projectRoot,
    env: options.env,
    homedir,
    scope: captureScope,
    query: options.retrieveQuery,
  });

  const retrievedFrameId = retrieveResult.preferences[0]?.frame.id;

  const projectionDryRunResult = await runAmpProjectionRender({
    projectRoot: options.projectRoot,
    source: "local",
    dryRun: true,
    env: options.env,
    homedir,
  });

  let projectionBodyContainsCapturedContent = false;
  const resolved = createProjectionRenderSource({
    sourceKind: "local",
    projectRef: context.projectRef,
    runtimeDbPath: context.runtimeDbPath,
    env: options.env,
  });

  if (!("error" in resolved)) {
    try {
      const documents = await Promise.resolve(
        resolved.source.loadProjectionDocuments({
          projectRef: context.projectRef,
        }),
      );
      const projectProjection = documents.find(
        (doc) => doc.metadata.kind === "project_projection",
      );
      const body = projectProjection?.body ?? "";
      projectionBodyContainsCapturedContent = body.includes(options.captureContent);
    } finally {
      resolved.cleanup();
    }
  }

  return {
    captureResult,
    consolidateResult,
    retrieveResult,
    projectionDryRunResult,
    queueDrained,
    retrievedFrameId,
    projectionBodyContainsCapturedContent,
  };
}
