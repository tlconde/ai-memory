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
import { runAmpCapture } from "../cli/capture.js";
import { runAmpConsolidate } from "../cli/consolidate.js";
import { resolveCliProjectContext } from "../cli/cli-context.js";
import { runAmpInit } from "../cli/init.js";
import { resolveLocalKnowledgeDbPath } from "../cli/knowledge-backend.js";
import { runAmpProjectionRender } from "../cli/projection.js";
import { createProjectionRenderSource } from "../cli/projection-source.js";
import { runAmpRetrieve } from "../cli/retrieve.js";
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
      return {
        step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
        passed: false,
        detail: "expected AMP_KNOWLEDGE_BACKEND unset for default local-persistent path",
      };
    }

    await mkdir(projectRoot, { recursive: true });

    const initResult = await runAmpInit({ projectRoot, env });
    if (!initResult.configCreated) {
      return {
        step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
        passed: false,
        detail: "amp init did not create project config",
      };
    }

    runAmpCapture({
      projectRoot,
      content: DURABLE_LOCAL_LOOP_CAPTURE_TEXT,
      scope: "project",
      env,
      homedir: rejectRealHomedir,
    });

    const consolidateResult = await runAmpConsolidate({
      projectRoot,
      env,
      homedir: rejectRealHomedir,
    });

    if (consolidateResult.processed !== 1) {
      return {
        step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
        passed: false,
        detail: `expected consolidate to process 1 frame, got ${consolidateResult.processed}`,
      };
    }
    if (consolidateResult.knowledgeBackend !== "local-persistent") {
      return {
        step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
        passed: false,
        detail: `expected local-persistent backend, got ${consolidateResult.knowledgeBackend}`,
      };
    }
    if (consolidateResult.knowledgeSource !== "local-sqlite") {
      return {
        step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
        passed: false,
        detail: `expected local-sqlite knowledge source, got ${consolidateResult.knowledgeSource}`,
      };
    }
    if (consolidateResult.liveGbrain !== undefined) {
      return {
        step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
        passed: false,
        detail: "expected no live gbrain during durable local acceptance loop",
      };
    }

    const frameId = consolidateResult.frameIds[0];
    if (!frameId) {
      return {
        step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
        passed: false,
        detail: "consolidate did not return a frame id",
      };
    }

    const context = resolveCliProjectContext({
      projectRoot,
      env,
      homedir: rejectRealHomedir,
    });
    const knowledgeDbPath = resolveLocalKnowledgeDbPath(context.runtimeDbPath);
    if (!existsSync(knowledgeDbPath)) {
      return {
        step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
        passed: false,
        detail: `expected knowledge.db at ${knowledgeDbPath}`,
      };
    }

    const knowledge = new LocalSqliteKnowledgeStore({ dbPath: knowledgeDbPath });
    try {
      const stored = knowledge.read(frameId);
      if (!stored) {
        return {
          step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
          passed: false,
          detail: `frame ${frameId} missing from knowledge.db`,
        };
      }
      if (stored.content !== DURABLE_LOCAL_LOOP_CAPTURE_TEXT) {
        return {
          step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
          passed: false,
          detail: "knowledge.db frame content does not match captured preference",
        };
      }
    } finally {
      knowledge.close();
    }

    const retrieveResult = await runAmpRetrieve({
      projectRoot,
      env,
      homedir: rejectRealHomedir,
      scope: "project",
      query: "typecheck before every AMP commit in acceptance gate",
    });

    if (retrieveResult.knowledgeBackend !== "local-persistent") {
      return {
        step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
        passed: false,
        detail: `retrieve expected local-persistent backend, got ${retrieveResult.knowledgeBackend}`,
      };
    }
    if (retrieveResult.knowledgeSource !== "local-sqlite") {
      return {
        step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
        passed: false,
        detail: `retrieve expected local-sqlite source, got ${retrieveResult.knowledgeSource}`,
      };
    }
    if (retrieveResult.preferences.length !== 1) {
      return {
        step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
        passed: false,
        detail: `expected 1 retrieved preference, got ${retrieveResult.preferences.length}`,
      };
    }
    if (retrieveResult.preferences[0]?.frame.id !== frameId) {
      return {
        step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
        passed: false,
        detail: "retrieved preference frame id does not match consolidated frame id",
      };
    }
    if (retrieveResult.preferences[0]?.frame.content !== DURABLE_LOCAL_LOOP_CAPTURE_TEXT) {
      return {
        step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
        passed: false,
        detail: "retrieved preference content does not match captured text",
      };
    }

    const dryRunResult = await runAmpProjectionRender({
      projectRoot,
      source: "local",
      dryRun: true,
      env,
      homedir: rejectRealHomedir,
    });

    if (!dryRunResult.ok) {
      return {
        step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
        passed: false,
        detail: dryRunResult.error ?? "projection dry-run failed",
      };
    }
    if (dryRunResult.source !== "local" || dryRunResult.dryRun !== true) {
      return {
        step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
        passed: false,
        detail: "projection dry-run did not report local dry-run source",
      };
    }
    if (dryRunResult.writes.length !== PROJECTION_FILE_KINDS.length) {
      return {
        step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
        passed: false,
        detail: `expected ${PROJECTION_FILE_KINDS.length} projection writes, got ${dryRunResult.writes.length}`,
      };
    }

    const resolved = createProjectionRenderSource({
      sourceKind: "local",
      projectRef: context.projectRef,
      runtimeDbPath: context.runtimeDbPath,
      env,
    });
    if ("error" in resolved) {
      return {
        step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
        passed: false,
        detail: resolved.error,
      };
    }

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
      if (!new RegExp(escapeRegex(DURABLE_LOCAL_LOOP_CAPTURE_TEXT)).test(body)) {
        return {
          step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
          passed: false,
          detail: "captured preference missing from local project projection document",
        };
      }
    } finally {
      resolved.cleanup();
    }

    return {
      step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
      passed: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      step: DURABLE_LOCAL_LOOP_ACCEPTANCE_STEP,
      passed: false,
      detail: message,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
