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

type FakeLink = {
  from_slug: string;
  to_slug: string;
  link_type?: string;
  context?: string;
};

export class FakeGbrainMcpTransport implements GbrainMcpTransport {
  private readonly pages = new Map<string, string>();
  private links: FakeLink[] = [];

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
      case "add_link": {
        const from_slug = String(args.from);
        const to_slug = String(args.to);
        const link_type = typeof args.link_type === "string" ? args.link_type : undefined;
        const context = typeof args.context === "string" ? args.context : undefined;
        const exists = this.links.some(
          (link) =>
            link.from_slug === from_slug &&
            link.to_slug === to_slug &&
            link.link_type === link_type
        );
        if (!exists) {
          this.links.push({ from_slug, to_slug, link_type, context });
        }
        return { status: "ok" };
      }
      case "remove_link": {
        const from_slug = String(args.from);
        const to_slug = String(args.to);
        this.links = this.links.filter(
          (link) => !(link.from_slug === from_slug && link.to_slug === to_slug)
        );
        return { status: "ok" };
      }
      case "get_links": {
        const slug = String(args.slug);
        return this.links.filter((link) => link.from_slug === slug).map(decorateFakeLink);
      }
      case "get_backlinks": {
        const slug = String(args.slug);
        return this.links.filter((link) => link.to_slug === slug).map(decorateFakeLink);
      }
      case "traverse_graph": {
        return this.fakeTraverse(args);
      }
      default:
        throw new Error(`FakeGbrainMcpTransport: unsupported tool ${name}`);
    }
  }

  /** BFS over the in-memory link graph, mirroring gbrain `traverse_graph` edge output. */
  private fakeTraverse(
    args: Record<string, unknown>
  ): Array<FakeLink & { depth: number }> {
    const start = String(args.slug);
    const direction = typeof args.direction === "string" ? args.direction : "out";
    const linkTypeFilter = typeof args.link_type === "string" ? args.link_type : undefined;
    const maxDepth = typeof args.depth === "number" ? Math.min(args.depth, 10) : 5;

    const edges: Array<FakeLink & { depth: number }> = [];
    const visited = new Set<string>([start]);
    let frontier: string[] = [start];

    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const link of this.links) {
          if (linkTypeFilter && link.link_type !== linkTypeFilter) continue;
          let neighbor: string | undefined;
          if ((direction === "out" || direction === "both") && link.from_slug === node) {
            neighbor = link.to_slug;
          } else if ((direction === "in" || direction === "both") && link.to_slug === node) {
            neighbor = link.from_slug;
          }
          if (neighbor === undefined) continue;
          edges.push({ ...link, depth });
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            next.push(neighbor);
          }
        }
      }
      frontier = next;
    }
    return edges;
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

function decorateFakeLink(link: FakeLink): FakeLink & {
  link_source: string;
  origin_slug: null;
  origin_field: null;
} {
  return { ...link, link_source: "api", origin_slug: null, origin_field: null };
}

export { extractPageContent };
