/**
 * gbrain MCP transport - primary v1 path is stdio via `gbrain serve`.
 *
 * Falsifiable claim: adapter talks to gbrain through MCP tools (put_page, get_page,
 * list_pages) over JSON-RPC, not direct PGLite access.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/** Injectable MCP tool surface for gbrain page operations. */
export interface GbrainMcpTransport {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close?(): Promise<void>;
}

export type GbrainServeStdioTransportOptions = {
  /** Executable on PATH; default `gbrain`. */
  command?: string;
  /** Subcommand args; default `["serve"]` for MCP stdio. */
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

/**
 * Primary v1 transport: spawn `gbrain serve` and invoke MCP tools over stdio.
 *
 * Live read/delete behavior against a real brain is PROVISIONAL (see amp-gbrain-spike.md).
 */
export class GbrainServeStdioTransport implements GbrainMcpTransport {
  private client: Client | undefined;
  private stdioTransport: StdioClientTransport | undefined;
  private connectPromise: Promise<void> | undefined;

  constructor(private readonly options: GbrainServeStdioTransportOptions = {}) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ensureConnected();
    const result = await this.client!.callTool({ name, arguments: args });
    return normalizeMcpToolResult(result as Parameters<typeof normalizeMcpToolResult>[0]);
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = undefined;
    await this.stdioTransport?.close();
    this.stdioTransport = undefined;
    this.connectPromise = undefined;
  }

  private ensureConnected(): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      this.stdioTransport = new StdioClientTransport({
        command: this.options.command ?? "gbrain",
        args: this.options.args ?? ["serve"],
        env: this.options.env,
        cwd: this.options.cwd,
      });
      this.client = new Client(
        { name: "amp-gbrain-knowledge-adapter", version: "0.1.0" },
        {}
      );
      await this.client.connect(this.stdioTransport);
    })();

    return this.connectPromise;
  }
}

export function normalizeMcpToolResult(result: {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}): unknown {
  if (result.isError) {
    const text = result.content?.find((part) => part.type === "text")?.text;
    throw new Error(text ?? "gbrain MCP tool returned isError");
  }

  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }

  const textPart = result.content?.find((part) => part.type === "text")?.text;
  if (textPart !== undefined) {
    try {
      return JSON.parse(textPart) as unknown;
    } catch {
      return textPart;
    }
  }

  return result;
}

export function extractPageContent(toolResult: unknown): string | undefined {
  if (typeof toolResult === "string") {
    return toolResult;
  }
  if (typeof toolResult !== "object" || toolResult === null) {
    return undefined;
  }
  const record = toolResult as Record<string, unknown>;
  if (typeof record.content === "string") {
    return record.content;
  }
  if (record.error !== undefined) {
    return undefined;
  }
  return undefined;
}

export type GbrainSearchHitRef = {
  slug: string;
  score: number;
};

/** Parse gbrain MCP `search` / `query` tool payloads into slug + score refs. */
export function extractSearchHitRefs(toolResult: unknown): GbrainSearchHitRef[] {
  if (Array.isArray(toolResult)) {
    return toolResult
      .map((entry) => parseSearchHitRef(entry))
      .filter((hit): hit is GbrainSearchHitRef => hit !== undefined);
  }

  if (typeof toolResult !== "object" || toolResult === null) {
    return [];
  }

  const record = toolResult as Record<string, unknown>;
  for (const key of ["results", "hits", "pages", "matches"] as const) {
    const collection = record[key];
    if (Array.isArray(collection)) {
      return collection
        .map((entry) => parseSearchHitRef(entry))
        .filter((hit): hit is GbrainSearchHitRef => hit !== undefined);
    }
  }

  if (typeof record.slug === "string") {
    const single = parseSearchHitRef(record);
    return single ? [single] : [];
  }

  return [];
}

function parseSearchHitRef(entry: unknown): GbrainSearchHitRef | undefined {
  if (typeof entry === "string") {
    return { slug: entry, score: 1 };
  }
  if (typeof entry !== "object" || entry === null) {
    return undefined;
  }
  const record = entry as Record<string, unknown>;
  const slug =
    typeof record.slug === "string"
      ? record.slug
      : typeof record.page_slug === "string"
        ? record.page_slug
        : undefined;
  if (!slug) {
    return undefined;
  }
  const score =
    typeof record.score === "number"
      ? record.score
      : typeof record.rank_score === "number"
        ? record.rank_score
        : typeof record.similarity === "number"
          ? record.similarity
          : 1;
  return { slug, score };
}

export function extractListedSlugs(toolResult: unknown): string[] {
  if (typeof toolResult !== "object" || toolResult === null) {
    return [];
  }
  const record = toolResult as Record<string, unknown>;
  const pages = record.pages;
  if (Array.isArray(pages)) {
    return pages
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (typeof entry === "object" && entry !== null && typeof (entry as { slug?: string }).slug === "string") {
          return (entry as { slug: string }).slug;
        }
        return undefined;
      })
      .filter((slug): slug is string => typeof slug === "string");
  }
  if (Array.isArray(record.slugs)) {
    return record.slugs.filter((slug): slug is string => typeof slug === "string");
  }
  return [];
}
