/**
 * Opt-in live gbrain projection verification (AMP-GBRAIN-PROJ-02).
 *
 * Skipped unless AMP_LIVE_GBRAIN=1. Requires `gbrain` on PATH with an initialized brain.
 * Default path is read-only: `amp projection render --source gbrain --dry-run` (no gbrain writes).
 * Optional sentinel frame setup requires AMP_CONFIRM_LIVE_GBRAIN_WRITE=1; cleanup is best-effort
 * with PROVISIONAL delete_page semantics.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";
import { frameIdToSlug } from "../adapters/ssa/gbrain/frame-codec.js";
import { createFrame } from "../core/frame-schema.js";
import { runAmpInit } from "../cli/init.js";
import { runAmpProjectionRender } from "../cli/projection.js";
import {
  AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV,
  assertLiveGbrainWriteConfirmed,
  formatResidualPageWarning,
  interpretDeletePageCleanup,
  isLiveGbrainTestEnabled,
  isLiveGbrainWriteConfirmed,
  type LiveGbrainCleanupReport,
} from "../gbrain/live-policy.js";
import { PROJECTION_FILE_KINDS } from "../projection/constants.js";
import { initGitRepo } from "./_helpers/invariant-6-git.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../");
const GBRAIN_SPEC = join(REPO_ROOT, "ssa-files/gbrain.yaml");

const LIVE_PROJECTION_FRAME_ID_PREFIX = "live-proj-";
const LIVE_PROJECTION_PROJECT_DIR = "gbrain-projection-live";

const LIVE_ENABLED = isLiveGbrainTestEnabled();
const LIVE_WRITE_CONFIRMED = isLiveGbrainWriteConfirmed();

function uniqueProjectionSentinelFrameId(): string {
  return `${LIVE_PROJECTION_FRAME_ID_PREFIX}${Date.now()}-${randomBytes(4).toString("hex")}`;
}

function assertAmpOwnedProjectionSlug(frameId: string, slug: string): void {
  assert.ok(frameId.startsWith(LIVE_PROJECTION_FRAME_ID_PREFIX), "sentinel must use AMP-owned id");
  assert.match(slug, /^amp\/frames\/h\.[0-9a-f]+$/, "sentinel must map to amp/frames/h.{hex}");
}

describe(
  "gbrain projection live verification",
  { skip: LIVE_ENABLED ? false : "set AMP_LIVE_GBRAIN=1 to run against gbrain serve (read-only projection)" },
  () => {
    let tempRoot = "";

    before(async () => {
      tempRoot = await mkdtemp(join(tmpdir(), "amp-gbrain-projection-live-"));
    });

    after(async () => {
      await rm(tempRoot, { recursive: true, force: true });
    });

    it("dry-runs gbrain projection render without gbrain writes or disk materialization", async () => {
      const projectRoot = join(tempRoot, LIVE_PROJECTION_PROJECT_DIR);
      const ampUserRoot = join(tempRoot, "amp-user-root");
      await mkdir(projectRoot, { recursive: true });
      initGitRepo(projectRoot);

      const env: NodeJS.ProcessEnv = {
        AMP_USER_ROOT: ampUserRoot,
        AMP_KNOWLEDGE_BACKEND: "gbrain",
      };

      await runAmpInit({ projectRoot, env });

      const result = await runAmpProjectionRender({
        projectRoot,
        source: "gbrain",
        dryRun: true,
        env,
      });

      assert.equal(result.ok, true, result.error ?? "projection dry-run failed");
      assert.equal(result.source, "gbrain");
      assert.equal(result.dryRun, true);
      assert.equal(result.writes.length, 4);
      assert.deepEqual(
        result.writes.map((write) => write.kind),
        [...PROJECTION_FILE_KINDS]
      );

      for (const write of result.writes) {
        assert.equal(write.dryRun, true);
        assert.equal(write.wrote, false);
        assert.equal(existsSync(write.path), false, `dry-run must not create ${write.path}`);
      }
    });
  }
);

describe(
  "gbrain projection live sentinel frame",
  {
    skip: LIVE_ENABLED
      ? LIVE_WRITE_CONFIRMED
        ? false
        : `set ${AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV}=1 to write AMP-owned sentinel frame`
      : "set AMP_LIVE_GBRAIN=1 to run against gbrain serve (read-only projection)",
  },
  () => {
    let tempRoot = "";

    before(async () => {
      tempRoot = await mkdtemp(join(tmpdir(), "amp-gbrain-projection-live-sentinel-"));
    });

    after(async () => {
      await rm(tempRoot, { recursive: true, force: true });
    });

    it("includes sentinel durable frame in gbrain projection dry-run and best-effort cleanup", async () => {
      assertLiveGbrainWriteConfirmed();

      const projectRoot = join(tempRoot, LIVE_PROJECTION_PROJECT_DIR);
      const ampUserRoot = join(tempRoot, "amp-user-root");
      await mkdir(projectRoot, { recursive: true });
      initGitRepo(projectRoot);

      const env: NodeJS.ProcessEnv = {
        AMP_USER_ROOT: ampUserRoot,
        AMP_KNOWLEDGE_BACKEND: "gbrain",
        AMP_CONFIRM_LIVE_GBRAIN_WRITE_ENV: "1",
      };

      await runAmpInit({ projectRoot, env });
      const projectRef = LIVE_PROJECTION_PROJECT_DIR;

      const frameId = uniqueProjectionSentinelFrameId();
      const slug = frameIdToSlug(frameId);
      assertAmpOwnedProjectionSlug(frameId, slug);

      const probeToken = `AMP-GBRAIN-PROJ-02 sentinel ${frameId}`;

      const adapter = new GbrainKnowledgeAdapter({
        ssaSpecPath: GBRAIN_SPEC,
        useLiveTransport: true,
      });

      const cleanupReport: LiveGbrainCleanupReport = {
        slug,
        frameId,
        cleanupAttempted: false,
        cleanupSucceeded: false,
      };

      try {
        const frame = createFrame({
          id: frameId,
          kind: "semantic",
          content: probeToken,
          source: { surface: "cursor" },
          created_at: new Date().toISOString(),
          scope: { kind: "project", project_ref: projectRef },
          curation_mode: "personal",
        });

        const write = await adapter.writeFrames([frame]);
        assert.equal(write.success, true, `sentinel write failed: ${JSON.stringify(write)}`);
        if (!write.success) return;

        const result = await runAmpProjectionRender({
          projectRoot,
          source: "gbrain",
          dryRun: true,
          env,
        });

        assert.equal(result.ok, true, result.error ?? "projection dry-run failed");
        const projectProjection = result.writes.find((write) => write.kind === "project_projection");
        assert.ok(projectProjection, "expected project_projection in dry-run plan");
        assert.ok(
          projectProjection.bytes > 0,
          "project_projection should include sentinel durable frame content"
        );
      } finally {
        cleanupReport.cleanupAttempted = true;
        try {
          const deleteResult = await adapter.transport.callTool("delete_page", { slug });
          const interpreted = interpretDeletePageCleanup(deleteResult);
          cleanupReport.cleanupSucceeded = interpreted.cleanupSucceeded;
          cleanupReport.deleteStatus = interpreted.deleteStatus;
        } catch {
          cleanupReport.cleanupSucceeded = false;
        }

        await adapter.transport.close?.();
      }

      assert.equal(cleanupReport.cleanupAttempted, true);
      if (!cleanupReport.cleanupSucceeded) {
        assert.fail(formatResidualPageWarning(cleanupReport));
      }
    });
  }
);
