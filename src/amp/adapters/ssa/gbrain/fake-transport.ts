/**
 * In-memory gbrain MCP transport for adapter tests (no live `gbrain serve`).
 */

import {
  extractListedSlugs,
  extractPageContent,
  extractSearchHitRefs,
  type GbrainMcpTransport,
} from "./transport.js";
import { isAmpFrameSlug } from "./frame-codec.js";

export class FakeGbrainMcpTransport implements GbrainMcpTransport {
  private readonly pages = new Map<string, string>();

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "put_page": {
        const slug = String(args.slug);
        const content = String(args.content);
        this.pages.set(slug, content);
        return { slug, status: "created_or_updated", chunks: 1 };
      }
      case "get_page": {
        const slug = String(args.slug);
        const content = this.pages.get(slug);
        if (content === undefined) {
          return { error: "not_found", slug };
        }
        return { slug, content };
      }
      case "list_pages": {
        const prefix =
          typeof args.prefix === "string" ? args.prefix : undefined;
        const slugs = [...this.pages.keys()].filter((slug) => {
          if (!isAmpFrameSlug(slug)) return false;
          if (prefix && !slug.startsWith(prefix)) return false;
          return true;
        });
        return { pages: slugs.map((slug) => ({ slug })) };
      }
      case "search":
      case "query": {
        return this.runFakeSearch(name, args);
      }
      default:
        throw new Error(`FakeGbrainMcpTransport: unsupported tool ${name}`);
    }
  }

  /** Test helper: seed a page without going through put_page. */
  seedPage(slug: string, content: string): void {
    this.pages.set(slug, content);
  }

  /** Test helper: read stored markdown for assertions. */
  getPageContent(slug: string): string | undefined {
    return this.pages.get(slug);
  }

  listAmpFrameSlugs(): string[] {
    return extractListedSlugs({ pages: [...this.pages.keys()].map((slug) => ({ slug })) }).filter(
      isAmpFrameSlug
    );
  }

  hasPage(slug: string): boolean {
    return this.pages.has(slug);
  }

  /** Test helper: last keyword search results from fake transport. */
  lastSearchHits(): ReturnType<typeof extractSearchHitRefs> {
    return this.lastHits;
  }

  private lastHits: ReturnType<typeof extractSearchHitRefs> = [];

  private runFakeSearch(
    tool: "search" | "query",
    args: Record<string, unknown>
  ): { results: Array<{ slug: string; score: number }> } {
    const query = String(args.query ?? "")
      .trim()
      .toLowerCase();
    const limit = typeof args.limit === "number" ? args.limit : 20;
    const hits: Array<{ slug: string; score: number }> = [];

    for (const [slug, content] of this.pages) {
      if (!isAmpFrameSlug(slug)) continue;
      const haystack = content.toLowerCase();
      if (query && !haystack.includes(query)) continue;
      hits.push({
        slug,
        score: tool === "query" ? 0.9 : 0.75,
      });
    }

    hits.sort((left, right) => right.score - left.score);
    const limited = hits.slice(0, limit);
    this.lastHits = limited;
    return { results: limited };
  }
}

export { extractPageContent };
