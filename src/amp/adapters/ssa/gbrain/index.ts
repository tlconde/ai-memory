/**
 * gbrain SSA adapter — MCP stdio (`gbrain serve`) knowledge backend.
 */

export {
  GbrainKnowledgeAdapter,
  createFrame,
  type GbrainKnowledgeAdapterOptions,
} from "./adapter.js";
export { FakeGbrainMcpTransport } from "./fake-transport.js";
export {
  AMP_FRAME_FRONTMATTER_KEY,
  AMP_FRAME_SLUG_PREFIX,
  decodePageContentToFrame,
  encodeFrameToPageContent,
  frameIdToSlug,
  isAmpFrameSlug,
} from "./frame-codec.js";
export {
  GbrainServeStdioTransport,
  normalizeMcpToolResult,
  type GbrainMcpTransport,
  type GbrainServeStdioTransportOptions,
} from "./transport.js";
