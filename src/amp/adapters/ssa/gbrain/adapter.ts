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
import type { KnowledgeListFilter } from "../../../substrate/storage/knowledge-store.js";

import {
  decodePageContentToFrame,
  encodeFrameToPageContent,
  frameIdToSlug,
  isAmpFrameSlug,
} from "./frame-codec.js";
import { FakeGbrainMcpTransport } from "./fake-transport.js";
import {
  extractListedSlugs,
  extractPageContent,
  extractSearchHitRefs,
  GbrainServeStdioTransport,
  type GbrainMcpTransport,
  type GbrainServeStdioTransportOptions,
} from "./transport.js";

const DEFAULT_GBRAIN_SSA_SPEC = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../ssa-files/gbrain.yaml"
);

export type GbrainSearchMode = "keyword" | "hybrid" | "vector" | "graph";

export type GbrainSearchOptions = {
  mode?: GbrainSearchMode;
  limit?: number;
};

export type GbrainKnowledgeAdapterOptions = {
  transport?: GbrainMcpTransport;
  ssaSpecPath?: string;
  /** When true and no transport provided, uses {@link FakeGbrainMcpTransport}. */
  useFakeTransport?: boolean;
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
    } else if (options.useFakeTransport) {
      this.transport = new FakeGbrainMcpTransport();
    } else {
      this.transport = new GbrainServeStdioTransport(options.stdioTransport);
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

      ids.push(frame.id);
    }

    return writeSuccess(ids.length, ids);
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

    const pageContent = extractPageContent(toolResult);
    if (pageContent === undefined) {
      return readSuccess([]);
    }

    const decoded = decodePageContentToFrame(pageContent);
    if (!decoded.success) {
      return readFailure(frameSchemaMismatch({ error: decoded.error, slug }));
    }

    return readSuccess([decoded.frame]);
  }

  async listFrames(filter: KnowledgeListFilter = {}): Promise<ListResult<Frame>> {
    let toolResult: unknown;
    try {
      toolResult = await this.transport.callTool("list_pages", { prefix: "amp/frames" });
    } catch (cause) {
      return listFailureTransport(toTransportAmpError(cause, "list_pages"));
    }

    const slugs = extractListedSlugs(toolResult).filter(isAmpFrameSlug);
    const frames: Frame[] = [];

    for (const slug of slugs) {
      let pageResult: unknown;
      try {
        pageResult = await this.transport.callTool("get_page", { slug });
      } catch (cause) {
        return listFailureTransport(toTransportAmpError(cause, "get_page"));
      }

      const content = extractPageContent(pageResult);
      if (content === undefined) continue;

      const decoded = decodePageContentToFrame(content);
      if (!decoded.success) {
        return listFailureTransport(frameSchemaMismatch({ error: decoded.error, slug }));
      }

      frames.push(decoded.frame);
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
    const hits: SearchHit<Frame>[] = [];

    for (const [rank, ref] of refs.entries()) {
      let pageResult: unknown;
      try {
        pageResult = await this.transport.callTool("get_page", { slug: ref.slug });
      } catch (cause) {
        return searchFailure(toTransportAmpError(cause, "get_page"));
      }

      const content = extractPageContent(pageResult);
      if (content === undefined) continue;

      const decoded = decodePageContentToFrame(content);
      if (!decoded.success) {
        return searchFailure(frameSchemaMismatch({ error: decoded.error, slug: ref.slug }));
      }

      hits.push({
        item: decoded.frame,
        score: ref.score,
        rank,
      });
    }

    return searchSuccess(hits);
  }

  async mutateFrame(_id: string, _patch: Partial<Frame>): Promise<MutateResult<Frame>> {
    return unsupportedMutateResult("mutate");
  }

  async deleteFrame(_id: string): Promise<MutateResult<Frame>> {
    return unsupportedMutateResult("mutate.delete");
  }

  async graphTraversal(_startId: string): Promise<SearchResult<Frame>> {
    return unsupportedSearchResult("graph_traversal");
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

function matchesKnowledgeListFilter(frame: Frame, filter: KnowledgeListFilter): boolean {
  if (filter.scopeKind && frame.scope.kind !== filter.scopeKind) return false;
  if (filter.projectRef && frame.scope.project_ref !== filter.projectRef) return false;
  if (filter.curationMode && frame.curation_mode !== filter.curationMode) return false;
  return true;
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

function listFailureTransport(error: AmpError): ListResult<Frame> {
  return { success: false, error };
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
