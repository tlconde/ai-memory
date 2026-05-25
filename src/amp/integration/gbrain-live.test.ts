/**
 * Opt-in live gbrain MCP integration (V1-LIVE-01 / AMP-REAL-04).
 *
 * Skipped unless AMP_LIVE_GBRAIN=1. Requires `gbrain` on PATH with an initialized brain.
 * Uses unique AMP-owned slugs only (`live-v1-*` → `amp/frames/h.{hex}`).
 * Attempts delete_page cleanup in finally; soft-delete uncertainty documented on failure.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";
import { frameIdToSlug } from "../adapters/ssa/gbrain/frame-codec.js";
import { createFrame } from "../core/frame-schema.js";
import {
  AMP_LIVE_PROJECT_REF,
  AMP_LIVE_SLUG_PREFIX,
  formatResidualPageWarning,
  interpretDeletePageCleanup,
  isAmpOwnedLiveFrameId,
  isLiveGbrainTestEnabled,
  type LiveGbrainCleanupReport,
} from "../gbrain/live-policy.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../");
const GBRAIN_SPEC = join(REPO_ROOT, "ssa-files/gbrain.yaml");

const LIVE_ENABLED = isLiveGbrainTestEnabled();

function uniqueLiveFrameId(): string {
  return `live-v1-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

function assertAmpOwnedSlug(frameId: string, slug: string): void {
  assert.equal(isAmpOwnedLiveFrameId(frameId), true, "live test must use AMP-owned frame ids");
  assert.match(
    slug,
    new RegExp(`^${AMP_LIVE_SLUG_PREFIX}[0-9a-f]+$`),
    "live test must write under amp/frames/h.{hex} only"
  );
}

describe(
  "gbrain live MCP round trip",
  { skip: LIVE_ENABLED ? false : "set AMP_LIVE_GBRAIN=1 to run against gbrain serve" },
  () => {
    it("writes, reads, lists, searches, and cleans up via gbrain serve stdio MCP", async () => {
      const frameId = uniqueLiveFrameId();
      const slug = frameIdToSlug(frameId);
      assertAmpOwnedSlug(frameId, slug);

      const probeToken = `AMP-LIVE-01 probe ${frameId}`;

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
          scope: { kind: "project", project_ref: AMP_LIVE_PROJECT_REF },
          curation_mode: "personal",
        });

        const write = await adapter.writeFrames([frame]);
        assert.equal(write.success, true, `write failed: ${JSON.stringify(write)}`);
        if (!write.success) return;
        assert.deepEqual(write.ids, [frameId]);

        const read = await adapter.readFrame(frameId);
        assert.equal(read.success, true, `read failed: ${JSON.stringify(read)}`);
        if (!read.success) return;
        assert.equal(read.items.length, 1);
        assert.equal(read.items[0]?.content, probeToken);

        const listed = await adapter.listFrames({
          scopeKind: "project",
          projectRef: AMP_LIVE_PROJECT_REF,
        });
        assert.equal(listed.success, true, `list failed: ${JSON.stringify(listed)}`);
        if (!listed.success) return;
        assert.ok(
          listed.items.some((item) => item.id === frameId),
          "frame should appear in project-scoped list"
        );

        const search = await adapter.searchFrames(probeToken, { mode: "keyword", limit: 5 });
        assert.equal(search.success, true, `search failed: ${JSON.stringify(search)}`);
        if (!search.success) return;
        assert.ok(
          search.hits.some((hit) => hit.item.id === frameId),
          "frame should appear in keyword search"
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
