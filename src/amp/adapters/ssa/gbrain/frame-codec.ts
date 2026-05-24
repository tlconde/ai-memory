/**
 * AMP frame ↔ gbrain markdown page codec.
 *
 * Pages store the canonical frame JSON in YAML frontmatter (`amp_frame`).
 * Live gbrain read semantics are PROVISIONAL - tests use fake transport only.
 */

import { Buffer } from "node:buffer";

import matter from "gray-matter";

import {
  parseFrame,
  serializeFrame,
  type Frame,
  type FrameParseResult,
} from "../../../core/frame-schema.js";

export const AMP_FRAME_FRONTMATTER_KEY = "amp_frame";
export const AMP_FRAME_SLUG_PREFIX = "amp/frames/";

/** Map frame id to a collision-resistant gbrain slug. */
export function frameIdToSlug(frameId: string): string {
  const encoded = Buffer.from(frameId, "utf8").toString("base64url");
  return `${AMP_FRAME_SLUG_PREFIX}${encoded}`;
}

export function isAmpFrameSlug(slug: string): boolean {
  return slug.startsWith(AMP_FRAME_SLUG_PREFIX);
}

/** Serialize a validated frame to gbrain page markdown (frontmatter + body). */
export function encodeFrameToPageContent(frame: Frame): string {
  const ampFrame = serializeFrame(frame);
  const body =
    typeof frame.content === "string"
      ? frame.content
      : JSON.stringify(frame.content, null, 2);

  return matter.stringify(body, {
    type: "note",
    [AMP_FRAME_FRONTMATTER_KEY]: ampFrame,
  });
}

export function decodePageContentToFrame(content: string): FrameParseResult {
  let parsed;
  try {
    parsed = matter(content);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { success: false, error: `Invalid page markdown: ${message}` };
  }

  const ampFrame = parsed.data[AMP_FRAME_FRONTMATTER_KEY];
  if (ampFrame === undefined || ampFrame === null) {
    return { success: false, error: "missing amp_frame frontmatter" };
  }

  return parseFrame(ampFrame);
}
