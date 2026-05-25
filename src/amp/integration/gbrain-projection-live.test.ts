/**
 * Opt-in live gbrain projection verification (AMP-GBRAIN-PROJ-02-REPAIR).
 *
 * Skipped unless AMP_LIVE_GBRAIN=1. Requires `gbrain` on PATH with an initialized brain.
 * Read-only path only: `amp projection render --source gbrain --dry-run` (no gbrain writes).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAmpInit } from "../cli/init.js";
import { runAmpProjectionRender } from "../cli/projection.js";
import { isLiveGbrainTestEnabled } from "../gbrain/live-policy.js";
import { PROJECTION_FILE_KINDS } from "../projection/constants.js";
import { initGitRepo } from "./_helpers/invariant-6-git.js";

const LIVE_PROJECTION_PROJECT_DIR = "gbrain-projection-live";
const LIVE_ENABLED = isLiveGbrainTestEnabled();

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
      };

      await runAmpInit({ projectRoot, env });

      const result = await runAmpProjectionRender({
        projectRoot,
        source: "gbrain",
        dryRun: true,
        strictGbrainPreflight: false,
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
