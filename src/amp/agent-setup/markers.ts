/**
 * AMP-managed marker blocks for user-owned harness files.
 *
 * Falsifiable claim: marker helpers replace or append idempotently and never
 * edit content outside the delimited block.
 */

export interface MarkerDelimiterPair {
  begin: string;
  end: string;
}

export const CLAUDE_CODE_MARKER: MarkerDelimiterPair = {
  begin: "<!-- amp:agent-setup:claude-code:v1:start -->",
  end: "<!-- amp:agent-setup:claude-code:v1:end -->",
};

export const CODEX_MARKER: MarkerDelimiterPair = {
  begin: "<!-- amp:agent-setup:codex:v1:start -->",
  end: "<!-- amp:agent-setup:codex:v1:end -->",
};

/** @deprecated Use CLAUDE_CODE_MARKER.begin */
export const AMP_AGENT_SETUP_MARKER_BEGIN = CLAUDE_CODE_MARKER.begin;
/** @deprecated Use CLAUDE_CODE_MARKER.end */
export const AMP_AGENT_SETUP_MARKER_END = CLAUDE_CODE_MARKER.end;

export class MarkerBlockError extends Error {
  override readonly name = "MarkerBlockError";

  constructor(message: string) {
    super(message);
  }
}

export interface MarkerBlockParts {
  before: string;
  inner: string;
  after: string;
}

function countOccurrences(content: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (true) {
    const found = content.indexOf(needle, index);
    if (found === -1) {
      return count;
    }
    count += 1;
    index = found + needle.length;
  }
}

/** True when exactly one begin/end pair is present. */
export function hasCompleteMarkerBlockFor(
  content: string,
  markers: MarkerDelimiterPair
): boolean {
  return (
    countOccurrences(content, markers.begin) === 1 &&
    countOccurrences(content, markers.end) === 1
  );
}

/** True when a single marker appears without its pair or markers are reversed. */
export function isMalformedMarkerBlockFor(
  content: string,
  markers: MarkerDelimiterPair
): boolean {
  const beginCount = countOccurrences(content, markers.begin);
  const endCount = countOccurrences(content, markers.end);
  if (beginCount === 0 && endCount === 0) {
    return false;
  }
  if (beginCount === 1 && endCount === 1) {
    const beginIndex = content.indexOf(markers.begin);
    const endIndex = content.indexOf(markers.end);
    if (endIndex < beginIndex) {
      return true;
    }
    return false;
  }
  return true;
}

/** Build a full marker block wrapping inner lines. */
export function buildMarkerBlockFor(
  innerLines: readonly string[],
  markers: MarkerDelimiterPair
): string {
  const inner = innerLines.join("\n");
  return [markers.begin, inner, markers.end].join("\n");
}

/** Parse content into before/inner/after when a complete marker block exists. */
export function parseMarkerBlockFor(
  content: string,
  markers: MarkerDelimiterPair
): MarkerBlockParts | undefined {
  if (!hasCompleteMarkerBlockFor(content, markers)) {
    return undefined;
  }
  const beginIndex = content.indexOf(markers.begin);
  const endIndex = content.indexOf(markers.end);
  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
    return undefined;
  }

  const before = content.slice(0, beginIndex);
  const innerStart = beginIndex + markers.begin.length;
  const inner = content.slice(innerStart, endIndex).replace(/^\n/, "").replace(/\n$/, "");
  const after = content.slice(endIndex + markers.end.length);
  return { before, inner, after };
}

/** Replace or append a marker block without touching surrounding user content. */
export function upsertMarkerBlockFor(
  content: string,
  innerLines: readonly string[],
  markers: MarkerDelimiterPair
): string {
  if (isMalformedMarkerBlockFor(content, markers)) {
    throw new MarkerBlockError(
      "Malformed AMP marker block: expected exactly one begin/end pair."
    );
  }

  const block = buildMarkerBlockFor(innerLines, markers);
  const parsed = parseMarkerBlockFor(content, markers);
  if (parsed) {
    const prefix = parsed.before.endsWith("\n") || parsed.before.length === 0 ? parsed.before : `${parsed.before}\n`;
    const suffix = parsed.after.startsWith("\n") || parsed.after.length === 0 ? parsed.after : `\n${parsed.after}`;
    return `${prefix}${block}${suffix}`;
  }

  if (content.length === 0) {
    return `${block}\n`;
  }

  const separator = content.endsWith("\n\n") ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  return `${content}${separator}${block}\n`;
}

export function hasCompleteMarkerBlock(content: string): boolean {
  return hasCompleteMarkerBlockFor(content, CLAUDE_CODE_MARKER);
}

export function isMalformedMarkerBlock(content: string): boolean {
  return isMalformedMarkerBlockFor(content, CLAUDE_CODE_MARKER);
}

export function buildMarkerBlock(innerLines: readonly string[]): string {
  return buildMarkerBlockFor(innerLines, CLAUDE_CODE_MARKER);
}

export function parseMarkerBlock(content: string): MarkerBlockParts | undefined {
  return parseMarkerBlockFor(content, CLAUDE_CODE_MARKER);
}

export function upsertMarkerBlock(content: string, innerLines: readonly string[]): string {
  return upsertMarkerBlockFor(content, innerLines, CLAUDE_CODE_MARKER);
}
