/**
 * §10.4.1 graph_traversal — LIVE gbrain parity (opt-in).
 *
 * Skipped unless AMP_LIVE_GBRAIN=1 and `gbrain serve` is reachable on PATH.
 * Run:  AMP_LIVE_GBRAIN=1 npx tsx --test src/amp/integration/gbrain-graph-live.test.ts
 *
 * Falsifiable claim (spec §10.4.1): writing frame B whose `supersedes` references
 * frame A causes a typed edge B -> A that traverse_graph / get_backlinks surface.
 * Pages are uniquely suffixed and deleted in teardown.
 */

import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createFrame } from "../core/frame-schema.js";
import { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";
import { frameIdToSlug } from "../adapters/ssa/gbrain/frame-codec.js";

const LIVE = process.env.AMP_LIVE_GBRAIN === "1";
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../");
const GBRAIN_SPEC = join(REPO_ROOT, "ssa-files/gbrain.yaml");

function frame(id: string, content: string, extra: Record<string, unknown> = {}) {
  return createFrame({
    id,
    kind: "semantic",
    content,
    source: { surface: "cursor" },
    created_at: new Date().toISOString(),
    scope: { kind: "project", project_ref: "ai-memory" },
    curation_mode: "personal",
    ...extra,
  });
}

describe(
  "gbrain graph_traversal (live)",
  { skip: LIVE ? false : "set AMP_LIVE_GBRAIN=1 to run against a live brain" },
  () => {
    it("emits + traverses a supersedes edge through a real brain", async () => {
      const adapter = new GbrainKnowledgeAdapter({
        useLiveTransport: true,
        ssaSpecPath: GBRAIN_SPEC,
      });
      const ts = Date.now();
      const oldId = `amp-live-graph-old-${ts}`;
      const newId = `amp-live-graph-new-${ts}`;

      try {
        await adapter.writeFrames([frame(oldId, "old guidance (live test)")]);
        await adapter.writeFrames([
          frame(newId, "new guidance (live test)", { supersedes: [oldId] }),
        ]);

        const out = await adapter.graphTraversal(newId, { direction: "out" });
        assert.ok(out.success, "traversal should succeed");
        assert.ok(
          out.hits.some((h) => h.item.id === oldId),
          "new frame should traverse out to the superseded frame"
        );
      } finally {
        for (const id of [oldId, newId]) {
          try {
            await adapter.transport.callTool("delete_page", { slug: frameIdToSlug(id) });
          } catch {
            // best-effort cleanup
          }
        }
        await adapter.transport.close?.();
      }
    });
  }
);
