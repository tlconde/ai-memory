/**
 * In-memory gbrain MCP transport for adapter tests (no live `gbrain serve`).
 */

import {
  extractListedSlugs,
  extractPageContent,
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
}

export { extractPageContent };
