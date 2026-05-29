/**
 * Acceptance gate step: durable local capture → consolidate → retrieve → projection.
 *
 * Falsifiable claim: offline init/capture/consolidate/retrieve/projection dry-run works
 * against persistent `.amp/runtime/knowledge.db` without gbrain or real homedir.
 */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LocalSqliteKnowledgeStore } from "../adapters/ssa/local-sqlite-knowledge-store.js";
import { resolveCliProjectContext } from "../cli/cli-context.js";
import { runAmpInit } from "../cli/init.js";
import { resolveLocalKnowledgeDbPath } from "../cli/knowledge-backend.js";
import { runDurableLocalCaptureLoop } from "../integration/_helpers/durable-local-capture-loop.js";
import {
  createIsolatedAmpTestEnv,
  PROJECTION_FILE_KINDS,
} from "../integration/_helpers/local-projection-fixture.js";
import type { AcceptanceStepResult } from "./acceptance-gate.js";

export const DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP =
  "acceptance: durable local knowledge loop";

/** Deterministic preference text for the offline durable-local acceptance loop. */
export const DURABLE_LOCAL_LOOP_CAPTURE_TEXT =
  "Run npm run typecheck before every AMP commit in acceptance gate durable local loop.";

const DURABLE_LOCAL_LOOP_RETRIEVE_QUERY =
  "typecheck before every AMP commit in acceptance gate";

function fail(detail: string): AcceptanceStepResult {
  return {
    step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
    passed: false,
    detail,
  };
}

export async function runDurableLocalLoopAcceptanceStep(): Promise<AcceptanceStepResult> {
  const tempRoot = await mkdtemp(join(tmpdir(), "amp-acceptance-durable-local-"));
  const label = "acceptance-durable-local";
  const projectRoot = join(tempRoot, label);

  try {
    const { env, rejectRealHomedir } = createIsolatedAmpTestEnv(tempRoot, label, {
      knowledgeBackend: false,
    });

    if (env.AMP_KNOWLEDGE_BACKEND !== undefined) {
      return fail("expected AMP_KNOWLEDGE_BACKEND unset for default local-persistent path");
    }

    await mkdir(projectRoot, { recursive: true });

    const initResult = await runAmpInit({ projectRoot, env });
    if (!initResult.configCreated) {
      return fail("amp init did not create project config");
    }

    const loop = await runDurableLocalCaptureLoop({
      projectRoot,
      env,
      captureContent: DURABLE_LOCAL_LOOP_CAPTURE_TEXT,
      captureScope: "project",
      retrieveQuery: DURABLE_LOCAL_LOOP_RETRIEVE_QUERY,
      homedir: rejectRealHomedir,
    });

    const { consolidateResult, retrieveResult, projectionDryRunResult } = loop;

    if (consolidateResult.processed !== 1) {
      return fail(`expected consolidate to process 1 frame, got ${consolidateResult.processed}`);
    }
    if (consolidateResult.knowledgeBackend !== "local-persistent") {
      return fail(`expected local-persistent backend, got ${consolidateResult.knowledgeBackend}`);
    }
    if (consolidateResult.knowledgeSource !== "local-sqlite") {
      return fail(`expected local-sqlite knowledge source, got ${consolidateResult.knowledgeSource}`);
    }
    if (consolidateResult.liveGbrain !== undefined) {
      return fail("expected no live gbrain during durable local acceptance loop");
    }

    const frameId = consolidateResult.frameIds[0];
    if (!frameId) {
      return fail("consolidate did not return a frame id");
    }

    const context = resolveCliProjectContext({
      projectRoot,
      env,
      homedir: rejectRealHomedir,
    });
    const knowledgeDbPath = resolveLocalKnowledgeDbPath(context.runtimeDbPath);
    if (!existsSync(knowledgeDbPath)) {
      return fail(`expected knowledge.db at ${knowledgeDbPath}`);
    }

    const knowledge = new LocalSqliteKnowledgeStore({ dbPath: knowledgeDbPath });
    try {
      const stored = knowledge.read(frameId);
      if (!stored) {
        return fail(`frame ${frameId} missing from knowledge.db`);
      }
      if (stored.content !== DURABLE_LOCAL_LOOP_CAPTURE_TEXT) {
        return fail("knowledge.db frame content does not match captured preference");
      }
    } finally {
      knowledge.close();
    }

    if (retrieveResult.knowledgeBackend !== "local-persistent") {
      return fail(`retrieve expected local-persistent backend, got ${retrieveResult.knowledgeBackend}`);
    }
    if (retrieveResult.knowledgeSource !== "local-sqlite") {
      return fail(`retrieve expected local-sqlite source, got ${retrieveResult.knowledgeSource}`);
    }
    if (retrieveResult.preferences.length !== 1) {
      return fail(`expected 1 retrieved preference, got ${retrieveResult.preferences.length}`);
    }
    if (loop.retrievedFrameId !== frameId) {
      return fail("retrieved preference frame id does not match consolidated frame id");
    }
    if (retrieveResult.preferences[0]?.frame.content !== DURABLE_LOCAL_LOOP_CAPTURE_TEXT) {
      return fail("retrieved preference content does not match captured text");
    }

    if (!projectionDryRunResult.ok) {
      return fail(projectionDryRunResult.error ?? "projection dry-run failed");
    }
    if (projectionDryRunResult.source !== "local" || projectionDryRunResult.dryRun !== true) {
      return fail("projection dry-run did not report local dry-run source");
    }
    if (projectionDryRunResult.writes.length !== PROJECTION_FILE_KINDS.length) {
      return fail(
        `expected ${PROJECTION_FILE_KINDS.length} projection writes, got ${projectionDryRunResult.writes.length}`,
      );
    }
    if (!loop.projectionBodyContainsCapturedContent) {
      return fail("captured preference missing from local project projection document");
    }

    return {
      step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
      passed: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(message);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
