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

export {
  CURSOR_PROJECTION_FILES_MISSING,
  CURSOR_PROJECTION_RULE_DESCRIPTION,
  CURSOR_PROJECTION_RULE_FILENAME,
  buildCursorProjectionMdc,
  resolveCursorSetupWritePath,
  runCursorProjectSetup,
  type CursorSetupOptions,
} from "./cursor.js";
