/**
 * Runtime projection upstream-sync marker block (AMP §16.5).
 */

import {
  buildMarkerBlockFor,
  type MarkerDelimiterPair,
} from "../agent-setup/markers.js";
import {
  estimateProjectionTextTokens,
  type ProjectionContentModel,
  type ProjectionTextBlock,
} from "../projection/content.js";
import type { PersistedUpstreamChangeset } from "./types.js";

export const UPSTREAM_SYNC_MARKER: MarkerDelimiterPair = {
  begin: "<!-- amp:upstream-sync:v1:start -->",
  end: "<!-- amp:upstream-sync:v1:end -->",
};

export const UPSTREAM_SYNC_BLOCK_TOKEN_BUDGET = 200;

const UPSTREAM_SYNC_BLOCK_PRIORITY = -100;
const UPSTREAM_SYNC_BLOCK_ID = "amp-upstream-sync-v1";

function formatChangesetSummary(changeset: PersistedUpstreamChangeset): string {
  const parts: string[] = [];
  if (changeset.added.length > 0) {
    parts.push(`${changeset.added.length} new`);
  }
  if (changeset.updated.length > 0) {
    parts.push(`${changeset.updated.length} updated`);
  }
  if (changeset.removed.length > 0) {
    parts.push(`${changeset.removed.length} removed`);
  }
  const summary = parts.length > 0 ? parts.join(", ") : "changes detected";
  const riskLabel =
    changeset.riskClass === "high"
      ? " (**HIGH risk — breaking**)"
      : changeset.riskClass === "medium"
        ? " (medium risk)"
        : " (low risk)";

  const lines = [
    `- **${changeset.sourceId}@${changeset.ref.upstream}** — ${summary}${riskLabel}`,
    `  Review: \`amp upstream review ${changeset.id}\``,
  ];

  if (changeset.riskClass === "high") {
    lines.push(`  Apply: \`amp upstream apply ${changeset.id} --confirm-breaking\``);
  } else if (changeset.added.length > 0) {
    lines.push(`  Quick-apply: \`amp upstream apply ${changeset.id} --only added\``);
  } else {
    lines.push(`  Apply: \`amp upstream apply ${changeset.id}\``);
  }

  return lines.join("\n");
}

function collapseLowRiskSummary(changesets: readonly PersistedUpstreamChangeset[]): string {
  const lowRisk = changesets.filter((entry) => entry.riskClass === "low");
  if (lowRisk.length <= 3) {
    const ids = lowRisk.map((entry) => entry.id).join(", ");
    return `- **${lowRisk.length} low-risk upstream update(s)** — review individually: ${ids}`;
  }
  return `- **${lowRisk.length} low-risk upstream update(s)** — use \`amp upstream review <id>\` for full diffs.`;
}

/** Render marker-wrapped upstream sync block text from pending changesets. */
export function renderUpstreamSyncBlockText(
  changesets: readonly PersistedUpstreamChangeset[]
): string | undefined {
  if (changesets.length === 0) {
    return undefined;
  }

  const mediumHigh = changesets.filter((entry) => entry.riskClass !== "low");
  const lowRisk = changesets.filter((entry) => entry.riskClass === "low");

  const tryBuild = (collapseLow: boolean, expandLow: boolean): string =>
    buildMarkerBlockFor(
      [
        "## Pending upstream updates",
        "",
        ...mediumHigh.flatMap((entry) => [formatChangesetSummary(entry), ""]),
        ...(expandLow ? lowRisk.flatMap((entry) => [formatChangesetSummary(entry), ""]) : []),
        ...(collapseLow && lowRisk.length > 0 ? [collapseLowRiskSummary(lowRisk), ""] : []),
      ],
      UPSTREAM_SYNC_MARKER
    );

  if (mediumHigh.length === 0 && lowRisk.length > 0) {
    const collapsedOnly = tryBuild(true, false);
    if (estimateProjectionTextTokens(collapsedOnly) <= UPSTREAM_SYNC_BLOCK_TOKEN_BUDGET) {
      return collapsedOnly;
    }
  }

  const full = tryBuild(lowRisk.length > 0 && mediumHigh.length > 0, mediumHigh.length === 0);
  if (estimateProjectionTextTokens(full) <= UPSTREAM_SYNC_BLOCK_TOKEN_BUDGET) {
    return full;
  }

  const mediumPlusCollapsed = tryBuild(true, false);
  if (estimateProjectionTextTokens(mediumPlusCollapsed) <= UPSTREAM_SYNC_BLOCK_TOKEN_BUDGET) {
    return mediumPlusCollapsed;
  }

  return buildMarkerBlockFor(
    [
      "## Pending upstream updates",
      "",
      `- **${changesets.length} pending upstream update(s)** — use \`amp upstream list\` and \`amp upstream review <id>\` for full diffs.`,
      "",
    ],
    UPSTREAM_SYNC_MARKER
  );
}

/** Inject upstream sync block into projectRuntime section of a projection model. */
export function appendUpstreamSyncProjectionBlock(
  model: ProjectionContentModel,
  changesets: readonly PersistedUpstreamChangeset[]
): void {
  const text = renderUpstreamSyncBlockText(changesets);
  if (!text) {
    return;
  }

  const block: ProjectionTextBlock = {
    id: UPSTREAM_SYNC_BLOCK_ID,
    label: "Upstream sync",
    priority: UPSTREAM_SYNC_BLOCK_PRIORITY,
    tokenEstimate: estimateProjectionTextTokens(text),
    text,
  };

  model.projectRuntime.blocks.unshift(block);
}
