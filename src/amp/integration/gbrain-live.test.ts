/**
 * Opt-in live gbrain MCP integration (V1-LIVE-01).
 *
 * Skipped unless AMP_LIVE_GBRAIN=1. Requires `gbrain` on PATH with an initialized brain.
 * Uses a unique AMP frame slug per run; attempts delete_page cleanup in finally.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";
import { frameIdToSlug } from "../adapters/ssa/gbrain/frame-codec.js";
import { createFrame } from "../core/frame-schema.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../");
const GBRAIN_SPEC = join(REPO_ROOT, "ssa-files/gbrain.yaml");

const LIVE_ENABLED = process.env.AMP_LIVE_GBRAIN === "1";

function uniqueLiveFrameId(): string {
  return `live-v1-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

describe(
  "gbrain live MCP round trip",
  { skip: LIVE_ENABLED ? false : "set AMP_LIVE_GBRAIN=1 to run against gbrain serve" },
  () => {
    it("writes, reads, lists, searches, and cleans up via gbrain serve stdio MCP", async () => {
      const frameId = uniqueLiveFrameId();
      const slug = frameIdToSlug(frameId);
      const probeToken = `AMP-LIVE-01 probe ${frameId}`;

      const adapter = new GbrainKnowledgeAdapter({
        ssaSpecPath: GBRAIN_SPEC,
        useLiveTransport: true,
      });

      let cleanupAttempted = false;
      let cleanupSucceeded = false;

      try {
        const frame = createFrame({
          id: frameId,
          kind: "semantic",
          content: probeToken,
          source: { surface: "cursor" },
          created_at: new Date().toISOString(),
          scope: { kind: "project", project_ref: "amp-live-verification" },
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
          projectRef: "amp-live-verification",
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
        cleanupAttempted = true;
        try {
          const deleteResult = await adapter.transport.callTool("delete_page", { slug });
          const status =
            typeof deleteResult === "object" && deleteResult !== null
              ? (deleteResult as { status?: string }).status
              : undefined;
          cleanupSucceeded = status === "soft_deleted" || status === "deleted";
        } catch {
          cleanupSucceeded = false;
        }

        await adapter.transport.close?.();
      }

      assert.equal(cleanupAttempted, true);
      assert.equal(
        cleanupSucceeded,
        true,
        `delete_page cleanup failed; residual slug may remain: ${slug}`
      );
    });
  }
);
