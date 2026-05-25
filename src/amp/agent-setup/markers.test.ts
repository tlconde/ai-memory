import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AMP_AGENT_SETUP_MARKER_BEGIN,
  AMP_AGENT_SETUP_MARKER_END,
  MarkerBlockError,
  buildMarkerBlock,
  hasCompleteMarkerBlock,
  isMalformedMarkerBlock,
  parseMarkerBlock,
  upsertMarkerBlock,
} from "./markers.js";

const INNER = ["@.amp/local/projection.md", "@.amp/local/runtime.md"];

describe("AMP agent setup marker blocks", () => {
  it("appends a block to empty file content", () => {
    const updated = upsertMarkerBlock("", INNER);
    assert.match(updated, /@\.amp\/local\/projection\.md/);
    assert.match(updated, new RegExp(`${AMP_AGENT_SETUP_MARKER_BEGIN}`));
    assert.match(updated, new RegExp(`${AMP_AGENT_SETUP_MARKER_END}`));
  });

  it("replaces an existing AMP block while preserving user content before and after", () => {
    const original = [
      "# Team notes",
      "",
      buildMarkerBlock(["@legacy/import.md"]),
      "",
      "## Footer",
    ].join("\n");

    const updated = upsertMarkerBlock(original, INNER);
    assert.match(updated, /^# Team notes/);
    assert.match(updated, /## Footer$/);
    assert.doesNotMatch(updated, /@legacy\/import\.md/);
    assert.match(updated, /@\.amp\/local\/projection\.md/);
    assert.equal(countMarkerPairs(updated), 1);
  });

  it("is idempotent on second apply", () => {
    const once = upsertMarkerBlock("# User\n", INNER);
    const twice = upsertMarkerBlock(once, INNER);
    assert.equal(twice, once);
  });

  it("treats a single marker without its pair as malformed", () => {
    const malformed = `${AMP_AGENT_SETUP_MARKER_BEGIN}\n@.amp/local/projection.md\n`;
    assert.equal(isMalformedMarkerBlock(malformed), true);
    assert.throws(() => upsertMarkerBlock(malformed, INNER), MarkerBlockError);
  });

  it("treats reversed begin/end markers as malformed", () => {
    const reversed = [
      AMP_AGENT_SETUP_MARKER_END,
      "@.amp/local/projection.md",
      AMP_AGENT_SETUP_MARKER_BEGIN,
    ].join("\n");
    assert.equal(isMalformedMarkerBlock(reversed), true);
    assert.throws(() => upsertMarkerBlock(reversed, INNER), MarkerBlockError);
  });

  it("parses inner content from a complete marker block", () => {
    const content = upsertMarkerBlock("", INNER);
    assert.equal(hasCompleteMarkerBlock(content), true);
    const parsed = parseMarkerBlock(content);
    assert.ok(parsed);
    assert.match(parsed.inner, /@\.amp\/local\/projection\.md/);
  });
});

function countMarkerPairs(content: string): number {
  return content.includes(AMP_AGENT_SETUP_MARKER_BEGIN) &&
    content.includes(AMP_AGENT_SETUP_MARKER_END)
    ? 1
    : 0;
}
