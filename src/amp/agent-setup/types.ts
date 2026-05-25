/**
 * Shared types for local agent-access setup (Wave 16).
 */

export type AgentSetupTarget = "claude-code" | "cursor";

export type AgentSetupMode = "dry-run" | "apply";

export interface AgentSetupResult {
  target: AgentSetupTarget;
  mode: AgentSetupMode;
  plannedPaths: string[];
  changed: boolean;
  ok: boolean;
  warnings: string[];
  errors: string[];
}
