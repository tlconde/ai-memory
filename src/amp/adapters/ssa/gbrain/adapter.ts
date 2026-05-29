/**
 * gbrain SSA knowledge adapter (read/write/list via MCP page tools).
 *
 * Primary transport: {@link GbrainServeStdioTransport} (`gbrain serve` stdio MCP).
 * Live gbrain read/delete claims remain PROVISIONAL - unit tests use {@link FakeGbrainMcpTransport}.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CapabilityCoverage } from "../../../adapter-contract/capability-coverage.js";
import { isCapabilitySupported } from "../../../adapter-contract/capability-coverage.js";
import {
  unsupportedCapabilityError,
  unsupportedListResult,
  unsupportedMutateResult,
  unsupportedReadResult,
  unsupportedSearchResult,
  unsupportedWriteResult,
} from "../../../adapter-contract/unsupported-capability.js";
import {
  listFailure,
  listSuccess,
  readFailure,
  readSuccess,
  searchFailure,
  searchSuccess,
  writeFailure,
  writeSuccess,
  type ListResult,
  type MutateResult,
  type ReadResult,
  type SearchHit,
  type SearchResult,
  type WriteResult,
} from "../../../adapter-contract/operation-results.js";
import {
  transactionBeginFailure,
  transactionCommitFailure,
  transactionRollbackFailure,
  type TransactionBeginResult,
  type TransactionCommitResult,
  type TransactionRollbackResult,
} from "../../../adapter-contract/transaction-contract.js";
import { AmpError, AmpErrorCode, frameSchemaMismatch, isAmpError } from "../../../core/errors.js";
import { createFrame, parseFrame, type Frame } from "../../../core/frame-schema.js";
import { loadSsaSpecFromFile } from "../../../ssa/loader.js";
import {
  matchesKnowledgeListFilter,
  type KnowledgeListFilter,
} from "../../../substrate/storage/knowledge-store.js";

import {
  decodePageResultToFrame,
  encodeFrameToPageContent,
  frameIdToSlug,
  isAmpFrameSlug,
} from "./frame-codec.js";
import { FakeGbrainMcpTransport } from "./fake-transport.js";
import {
  extractGraphEdges,
  extractListedSlugs,
  extractSearchHitRefs,
  GbrainServeStdioTransport,
  type GbrainMcpTransport,
  type GbrainServeStdioTransportOptions,
} from "./transport.js";

const DEFAULT_GBRAIN_SSA_SPEC = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../ssa-files/gbrain.yaml"
);

export type GbrainSearchMode = "keyword" | "hybrid" | "vector" | "graph";

export type GbrainSearchOptions = {
  mode?: GbrainSearchMode;
  limit?: number;
};

export type GbrainGraphDirection = "in" | "out" | "both";

export type GbrainGraphTraversalOptions = {
  /** Max traversal depth (gbrain default 5, capped 10). */
  depth?: number;
  /** Edge direction relative to the start frame. Default "out". */
  direction?: GbrainGraphDirection;
  /** Restrict traversal to a single gbrain link_type. */
  linkType?: string;
};

/**
 * AMP typed cross-reference → gbrain `link_type`. Namespaced with the `amp:`
 * prefix so substrate edges never collide with the user's domain links
 * (e.g. invested_in, works_at).
 */
export const AMP_FRAME_LINK_TYPES = {
  supersedes: "amp:supersedes",
  superseded_by: "amp:superseded_by",
  correction_of: "amp:correction_of",
} as const;

export type GbrainKnowledgeAdapterOptions = {
  transport?: GbrainMcpTransport;
  ssaSpecPath?: string;
  /** @deprecated Fake transport is now the safe default when no transport is provided. */
  useFakeTransport?: boolean;
  /** Explicitly opt in to spawning live `gbrain serve` when no transport is provided. */
  useLiveTransport?: boolean;
  stdioTransport?: GbrainServeStdioTransportOptions;
};

export class GbrainKnowledgeAdapter {
  readonly transport: GbrainMcpTransport;
  private readonly coverage: CapabilityCoverage;

  constructor(options: GbrainKnowledgeAdapterOptions = {}) {
    const specPath = options.ssaSpecPath ?? DEFAULT_GBRAIN_SSA_SPEC;
    const spec = loadSsaSpecFromFile(specPath);
    this.coverage = structuredClone(spec.capability_coverage);

    if (options.transport) {
      this.transport = options.transport;
    } else if (options.useLiveTransport || options.stdioTransport) {
      this.transport = new GbrainServeStdioTransport(options.stdioTransport);
    } else {
      this.transport = new FakeGbrainMcpTransport();
    }
  }

  capabilities(): CapabilityCoverage {
    return structuredClone(this.coverage);
  }

  async writeFrames(frames: Frame[]): Promise<WriteResult> {
    const ids: string[] = [];

    for (const candidate of frames) {
      const parsed = parseFrame(candidate);
      if (!parsed.success) {
        return writeFailure(frameSchemaMismatch({ error: parsed.error }));
      }

      const frame = parsed.frame;
      const slug = frameIdToSlug(frame.id);
      const content = encodeFrameToPageContent(frame);

      try {
        await this.transport.callTool("put_page", { slug, content });
      } catch (cause) {
        return writeFailure(toTransportAmpError(cause, "put_page"));
      }

      if (isCapabilitySupported(this.coverage, "graph_traversal")) {
        await this.emitFrameLinks(frame, slug);
      }

      ids.push(frame.id);
    }

    return writeSuccess(ids.length, ids);
  }

  /**
   * Emit typed graph edges for a frame's cross-references via gbrain `add_link`.
   *
   * Deterministic alternative to relying on gbrain's `auto_link` wikilink
   * inference (which is config-gated). Best-effort at the wrapped level: a
   * missing target page or transport hiccup must never fail the frame write.
   */
  private async emitFrameLinks(frame: Frame, fromSlug: string): Promise<void> {
    const targets: Array<{ refId: string; linkType: string }> = [];
    for (const refId of frame.supersedes ?? []) {
      targets.push({ refId, linkType: AMP_FRAME_LINK_TYPES.supersedes });
    }
    if (frame.superseded_by) {
      targets.push({ refId: frame.superseded_by, linkType: AMP_FRAME_LINK_TYPES.superseded_by });
    }
    if (frame.correction_of) {
      targets.push({ refId: frame.correction_of, linkType: AMP_FRAME_LINK_TYPES.correction_of });
    }

    for (const { refId, linkType } of targets) {
      try {
        await this.transport.callTool("add_link", {
          from: fromSlug,
          to: frameIdToSlug(refId),
          link_type: linkType,
        });
      } catch {
        // best-effort typed-edge emission (wrapped level)
      }
    }
  }

  /**
   * Read a frame by AMP id via MCP `get_page`.
   *
   * PROVISIONAL: not conformance-tested against live gbrain in CI (fake transport in tests).
   */
  async readFrame(id: string): Promise<ReadResult<Frame>> {
    const slug = frameIdToSlug(id);

    let toolResult: unknown;
    try {
      toolResult = await this.transport.callTool("get_page", { slug });
    } catch (cause) {
      return readFailure(toTransportAmpError(cause, "get_page"));
    }

    const decoded = pageResultToFrame(slug, toolResult);
    if (decoded.success && decoded.frame === undefined) {
      return readSuccess([]);
    }
    if (!decoded.success) {
      return readFailure(decoded.error);
    }

    return decoded.frame === undefined ? readSuccess([]) : readSuccess([decoded.frame]);
  }

  async listFrames(filter: KnowledgeListFilter = {}): Promise<ListResult<Frame>> {
    let toolResult: unknown;
    try {
      toolResult = await this.transport.callTool("list_pages", { prefix: "amp/frames" });
    } catch (cause) {
      return listFailure(toTransportAmpError(cause, "list_pages"));
    }

    const slugs = extractListedSlugs(toolResult).filter(isAmpFrameSlug);
    const decodedPages = await Promise.all(
      slugs.map(async (slug) => {
        let pageResult: unknown;
        try {
          pageResult = await this.transport.callTool("get_page", { slug });
        } catch (cause) {
          return { success: false as const, error: toTransportAmpError(cause, "get_page") };
        }
        return pageResultToFrame(slug, pageResult);
      })
    );

    const frames: Frame[] = [];
    for (const decoded of decodedPages) {
      if (!decoded.success) {
        return listFailure(decoded.error);
      }
      if (decoded.frame !== undefined) {
        frames.push(decoded.frame);
      }
    }

    const filtered = frames.filter((frame) => matchesKnowledgeListFilter(frame, filter));
    return listSuccess(filtered);
  }

  /**
   * Search AMP frames via gbrain MCP `search` (keyword) or `query` (hybrid/vector).
   *
   * PROVISIONAL: live gbrain search parity is tested via {@link FakeGbrainMcpTransport} only.
   */
  async searchFrames(
    query: string,
    options: GbrainSearchOptions = {}
  ): Promise<SearchResult<Frame>> {
    const mode = options.mode ?? "keyword";
    const capabilityError = checkSearchModeCapability(this.coverage, mode);
    if (capabilityError) {
      return unsupportedSearchResult(capabilityError);
    }

    const tool = resolveGbrainSearchTool(mode);
    const toolArgs: Record<string, unknown> = { query };
    if (options.limit !== undefined) {
      toolArgs.limit = options.limit;
    }

    let toolResult: unknown;
    try {
      toolResult = await this.transport.callTool(tool, toolArgs);
    } catch (cause) {
      return searchFailure(toTransportAmpError(cause, tool));
    }

    const refs = extractSearchHitRefs(toolResult).filter((hit) => isAmpFrameSlug(hit.slug));
    const decodedHits = await Promise.all(
      refs.map(async (ref, rank) => {
        let pageResult: unknown;
        try {
          pageResult = await this.transport.callTool("get_page", { slug: ref.slug });
        } catch (cause) {
          return { success: false as const, error: toTransportAmpError(cause, "get_page") };
        }

        const decoded = pageResultToFrame(ref.slug, pageResult);
        if (!decoded.success || decoded.frame === undefined) {
          return decoded;
        }

        return {
          success: true as const,
          hit: {
            item: decoded.frame,
            score: ref.score,
            rank,
          },
        };
      })
    );

    const hits: SearchHit<Frame>[] = [];
    for (const decoded of decodedHits) {
      if (!decoded.success) {
        return searchFailure(decoded.error);
      }
      if ("hit" in decoded) {
        hits.push(decoded.hit);
      }
    }

    return searchSuccess(hits);
  }

  async mutateFrame(_id: string, _patch: Partial<Frame>): Promise<MutateResult<Frame>> {
    return unsupportedMutateResult("mutate");
  }

  async deleteFrame(_id: string): Promise<MutateResult<Frame>> {
    return unsupportedMutateResult("mutate.delete");
  }

  /**
   * Traverse the gbrain link graph from a frame via MCP `traverse_graph`,
   * resolving reachable nodes back into AMP frames.
   *
   * PROVISIONAL against live gbrain: covered offline by {@link FakeGbrainMcpTransport};
   * live parity asserted by `src/amp/integration/gbrain-graph-live.test.ts`
   * (opt-in `AMP_LIVE_GBRAIN=1`).
   */
  async graphTraversal(
    startId: string,
    options: GbrainGraphTraversalOptions = {}
  ): Promise<SearchResult<Frame>> {
    if (!isCapabilitySupported(this.coverage, "graph_traversal")) {
      return unsupportedSearchResult("graph_traversal");
    }

    const direction = options.direction ?? "out";
    const startSlug = frameIdToSlug(startId);
    const args: Record<string, unknown> = { slug: startSlug, direction };
    if (options.depth !== undefined) {
      args.depth = options.depth;
    }
    if (options.linkType !== undefined) {
      args.link_type = options.linkType;
    }

    let toolResult: unknown;
    try {
      toolResult = await this.transport.callTool("traverse_graph", args);
    } catch (cause) {
      return searchFailure(toTransportAmpError(cause, "traverse_graph"));
    }

    // Resolve the node on the far side of each edge relative to the start,
    // dedupe by slug, preserve traversal order (shallowest first).
    const ordered: Array<{ slug: string; depth: number }> = [];
    const seen = new Set<string>();
    for (const edge of extractGraphEdges(toolResult)) {
      let otherSlug: string;
      if (direction === "in") {
        otherSlug = edge.fromSlug;
      } else if (direction === "out") {
        otherSlug = edge.toSlug;
      } else {
        otherSlug = edge.fromSlug === startSlug ? edge.toSlug : edge.fromSlug;
      }
      if (otherSlug === startSlug || !isAmpFrameSlug(otherSlug) || seen.has(otherSlug)) {
        continue;
      }
      seen.add(otherSlug);
      ordered.push({ slug: otherSlug, depth: edge.depth ?? 1 });
    }

    const decodedHits = await Promise.all(
      ordered.map(async ({ slug, depth }, rank) => {
        let pageResult: unknown;
        try {
          pageResult = await this.transport.callTool("get_page", { slug });
        } catch (cause) {
          return { success: false as const, error: toTransportAmpError(cause, "get_page") };
        }
        const decoded = pageResultToFrame(slug, pageResult);
        if (!decoded.success) {
          return decoded;
        }
        if (decoded.frame === undefined) {
          return { success: true as const, hit: undefined };
        }
        return {
          success: true as const,
          hit: { item: decoded.frame, score: 1 / depth, rank } satisfies SearchHit<Frame>,
        };
      })
    );

    const hits: SearchHit<Frame>[] = [];
    for (const decoded of decodedHits) {
      if (!decoded.success) {
        return searchFailure(decoded.error);
      }
      if (decoded.hit !== undefined) {
        hits.push(decoded.hit);
      }
    }

    return searchSuccess(hits);
  }

  /**
   * Create a typed graph edge between two frames via gbrain `add_link`.
   * `linkType` is freeform; prefer the namespaced {@link AMP_FRAME_LINK_TYPES}.
   */
  async addLink(
    fromId: string,
    toId: string,
    linkType: string,
    context?: string
  ): Promise<WriteResult> {
    if (!isCapabilitySupported(this.coverage, "graph_traversal")) {
      return unsupportedWriteResult("graph_traversal");
    }
    const args: Record<string, unknown> = {
      from: frameIdToSlug(fromId),
      to: frameIdToSlug(toId),
      link_type: linkType,
    };
    if (context !== undefined) {
      args.context = context;
    }
    try {
      await this.transport.callTool("add_link", args);
    } catch (cause) {
      return writeFailure(toTransportAmpError(cause, "add_link"));
    }
    return writeSuccess(1, [`${fromId} -> ${toId}`]);
  }

  async readProfileSlot(_slot: string): Promise<ReadResult<Frame>> {
    return unsupportedReadResult("profile_slots");
  }

  async listProceduralRegistry(): Promise<ListResult<Frame>> {
    return unsupportedListResult("procedural_registry");
  }

  async transactionBegin(): Promise<TransactionBeginResult> {
    return transactionBeginFailure(unsupportedCapabilityError("transactions"));
  }

  async transactionCommit(): Promise<TransactionCommitResult> {
    return transactionCommitFailure(unsupportedCapabilityError("transactions"), false);
  }

  async transactionRollback(): Promise<TransactionRollbackResult> {
    return transactionRollbackFailure(unsupportedCapabilityError("transactions"));
  }

  async writeProceduralRegistry(_frames: Frame[]): Promise<WriteResult> {
    return unsupportedWriteResult("procedural_registry");
  }
}

function pageResultToFrame(
  slug: string,
  toolResult: unknown
):
  | { success: true; frame: Frame | undefined }
  | { success: false; error: AmpError } {
  const decoded = decodePageResultToFrame(toolResult);
  if (decoded === undefined) {
    return { success: true, frame: undefined };
  }
  if (!decoded.success) {
    return { success: false, error: frameSchemaMismatch({ error: decoded.error, slug }) };
  }

  return { success: true, frame: decoded.frame };
}

function toTransportAmpError(cause: unknown, tool: string): AmpError {
  if (isAmpError(cause)) {
    return cause;
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return new AmpError({
    code: AmpErrorCode.SUBSTRATE_OFFLINE,
    message: `gbrain MCP ${tool} failed: ${message}`,
    data: { tool },
    retriable: true,
  });
}

function checkSearchModeCapability(
  coverage: CapabilityCoverage,
  mode: GbrainSearchMode
): string | undefined {
  if (mode === "graph") {
    return "graph_traversal";
  }
  if (mode === "keyword" && !isCapabilitySupported(coverage, "full_text_search")) {
    return "full_text_search";
  }
  if (mode === "vector" && !isCapabilitySupported(coverage, "vector_search")) {
    return "vector_search";
  }
  if (mode === "hybrid") {
    if (!isCapabilitySupported(coverage, "vector_search")) {
      return "vector_search";
    }
    if (!isCapabilitySupported(coverage, "full_text_search")) {
      return "full_text_search";
    }
  }
  return undefined;
}

function resolveGbrainSearchTool(mode: GbrainSearchMode): "search" | "query" {
  if (mode === "keyword") {
    return "search";
  }
  return "query";
}

export { createFrame };
