/**
 * Read-only gbrain MCP transport wrapper for projection render.
 *
 * Falsifiable claim: mutating MCP tools are rejected before reaching the inner transport.
 */

import type { GbrainMcpTransport } from "./transport.js";

export const GBRAIN_MUTATING_MCP_TOOLS = ["put_page", "delete_page", "restore_page"] as const;

export type GbrainMutatingMcpTool = (typeof GBRAIN_MUTATING_MCP_TOOLS)[number];

const MUTATING_TOOL_SET = new Set<string>(GBRAIN_MUTATING_MCP_TOOLS);

export class ReadonlyGbrainMcpTransport implements GbrainMcpTransport {
  constructor(private readonly inner: GbrainMcpTransport) {}

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (MUTATING_TOOL_SET.has(name)) {
      throw new Error(`Readonly gbrain transport rejected mutating tool ${name}.`);
    }
    return this.inner.callTool(name, args);
  }

  async close(): Promise<void> {
    await this.inner.close?.();
  }
}
