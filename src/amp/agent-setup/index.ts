/**
 * Local agent-access setup — shared contracts and marker helpers.
 */

export type {
  AgentSetupMode,
  AgentSetupOptions,
  AgentSetupResult,
  AgentSetupTarget,
} from "./types.js";

export {
  AMP_AGENT_SETUP_MARKER_BEGIN,
  AMP_AGENT_SETUP_MARKER_END,
  MarkerBlockError,
  buildMarkerBlock,
  hasCompleteMarkerBlock,
  isMalformedMarkerBlock,
  parseMarkerBlock,
  upsertMarkerBlock,
  type MarkerBlockParts,
} from "./markers.js";

export {
  CLAUDE_PROJECT_FILENAME,
  PROJECTION_MATERIALIZATION_REQUIRED,
  inspectClaudeCodeMarkerBlock,
  runClaudeCodeProjectSetup,
  type ClaudeCodeSetupOptions,
} from "./claude-code.js";
