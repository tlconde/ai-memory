/**
 * AMP-managed marker blocks for user-owned harness files.
 *
 * Falsifiable claim: marker helpers replace or append idempotently and never
 * edit content outside the delimited block.
 */

export const AMP_AGENT_SETUP_MARKER_BEGIN = "<!-- amp:agent-setup:claude-code:v1:start -->";
export const AMP_AGENT_SETUP_MARKER_END = "<!-- amp:agent-setup:claude-code:v1:end -->";

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
export function hasCompleteMarkerBlock(content: string): boolean {
  return (
    countOccurrences(content, AMP_AGENT_SETUP_MARKER_BEGIN) === 1 &&
    countOccurrences(content, AMP_AGENT_SETUP_MARKER_END) === 1
  );
}

/** True when a single marker appears without its pair. */
export function isMalformedMarkerBlock(content: string): boolean {
  const beginCount = countOccurrences(content, AMP_AGENT_SETUP_MARKER_BEGIN);
  const endCount = countOccurrences(content, AMP_AGENT_SETUP_MARKER_END);
  if (beginCount === 0 && endCount === 0) {
    return false;
  }
  if (beginCount === 1 && endCount === 1) {
    return false;
  }
  return true;
}

/** Build a full marker block wrapping inner lines. */
export function buildMarkerBlock(innerLines: readonly string[]): string {
  const inner = innerLines.join("\n");
  return [
    AMP_AGENT_SETUP_MARKER_BEGIN,
    inner,
    AMP_AGENT_SETUP_MARKER_END,
  ].join("\n");
}

/** Parse content into before/inner/after when a complete marker block exists. */
export function parseMarkerBlock(content: string): MarkerBlockParts | undefined {
  if (!hasCompleteMarkerBlock(content)) {
    return undefined;
  }
  const beginIndex = content.indexOf(AMP_AGENT_SETUP_MARKER_BEGIN);
  const endIndex = content.indexOf(AMP_AGENT_SETUP_MARKER_END);
  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
    return undefined;
  }

  const before = content.slice(0, beginIndex);
  const innerStart = beginIndex + AMP_AGENT_SETUP_MARKER_BEGIN.length;
  const inner = content.slice(innerStart, endIndex).replace(/^\n/, "").replace(/\n$/, "");
  const after = content.slice(endIndex + AMP_AGENT_SETUP_MARKER_END.length);
  return { before, inner, after };
}

/** Replace or append a marker block without touching surrounding user content. */
export function upsertMarkerBlock(content: string, innerLines: readonly string[]): string {
  if (isMalformedMarkerBlock(content)) {
    throw new MarkerBlockError(
      "Malformed AMP marker block: expected exactly one begin/end pair."
    );
  }

  const block = buildMarkerBlock(innerLines);
  const parsed = parseMarkerBlock(content);
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
