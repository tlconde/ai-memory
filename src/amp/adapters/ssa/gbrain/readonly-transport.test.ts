import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { FakeGbrainMcpTransport } from "./fake-transport.js";
import { GBRAIN_MUTATING_MCP_TOOLS, ReadonlyGbrainMcpTransport } from "./readonly-transport.js";

describe("ReadonlyGbrainMcpTransport", () => {
  it("rejects known mutating MCP tools", async () => {
    const transport = new ReadonlyGbrainMcpTransport(new FakeGbrainMcpTransport());

    for (const tool of GBRAIN_MUTATING_MCP_TOOLS) {
      await assert.rejects(
        () => transport.callTool(tool, { slug: "amp/frames/h.test" }),
        /Readonly gbrain transport rejected mutating tool/
      );
    }
  });

  it("forwards read-only MCP tools to the inner transport", async () => {
    const inner = new FakeGbrainMcpTransport();
    inner.seedPage("amp/frames/h.readonly", "Read-only probe.");
    const transport = new ReadonlyGbrainMcpTransport(inner);

    const page = await transport.callTool("get_page", { slug: "amp/frames/h.readonly" });
    assert.deepEqual(page, { slug: "amp/frames/h.readonly", content: "Read-only probe." });
  });
});
