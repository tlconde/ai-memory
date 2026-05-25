/**
 * Local agent-access setup — shared contracts and marker helpers.
 */

export type {
  AgentSetupMode,
  AgentSetupResult,
  AgentSetupTarget,
} from "./types.js";

export {
  CODEX_PROJECT_FILENAME,
  PROJECTION_MATERIALIZATION_REQUIRED as CODEX_PROJECTION_FILES_MISSING,
  buildCodexMarkerInner,
  inspectCodexMarkerBlock,
  runCodexProjectSetup,
  type CodexSetupOptions,
} from "./codex.js";

export {
  AMP_AGENT_SETUP_MARKER_BEGIN,
  AMP_AGENT_SETUP_MARKER_END,
  CLAUDE_CODE_MARKER,
  CODEX_MARKER,
  MarkerBlockError,
  buildMarkerBlock,
  buildMarkerBlockFor,
  hasCompleteMarkerBlock,
  hasCompleteMarkerBlockFor,
  isMalformedMarkerBlock,
  isMalformedMarkerBlockFor,
  parseMarkerBlock,
  parseMarkerBlockFor,
  upsertMarkerBlock,
  upsertMarkerBlockFor,
  type MarkerBlockParts,
  type MarkerDelimiterPair,
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

export {
  PROJECTION_FILES_MISSING_WARNING,
  checkProjectProjectionPreflight,
  type ProjectProjectionPreflightOptions,
  type ProjectProjectionPreflightResult,
} from "./preflight.js";
