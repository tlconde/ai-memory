/**
 * Pure runtime projection formatting helpers (RUNTIME-04).
 *
 * Falsifiable claim: runtime entities format into projection-safe line arrays
 * that never render pending decisions as facts, inactive preferences as
 * instructions, or sensitive/rejected content as readable payload.
 */

import type { ScopeKind } from "../core/frame-schema.js";
import type {
  CurrentDecisionLeaning,
  EpisodicFrame,
  HarnessOperationalState,
  RejectedSignalLog,
  RuntimeCrystalCandidate,
  RuntimePreferenceCandidate,
  UnresolvedDecision,
} from "./schema.js";

export interface RuntimeProjectionFormat {
  lines: string[];
  activeInstruction: boolean;
}

export interface FormatUnresolvedDecisionOptions {
  currentLeaning?: CurrentDecisionLeaning;
  includeStaleLeaning?: boolean;
}

export interface FormatRuntimePreferenceOptions {
  omitInactive?: boolean;
}

export interface FormatRuntimeCrystalOptions {
  /** Reserved for future projection tuning. */
}

export interface FormatHarnessOperationalOptions {
  includeClosed?: boolean;
}

export interface FormatEpisodicFrameOptions {
  includeDormantMetadata?: boolean;
}

export interface FormatRejectedSignalLogOptions {
  /** Reserved for future projection tuning. */
}

function formatScopeLine(scope: ScopeKind, projectRef?: string): string {
  if (scope === "project" && projectRef) {
    return `Scope: project (${projectRef})`;
  }
  return `Scope: ${scope}`;
}

function formatDecisionOptions(decision: UnresolvedDecision): string[] {
  return decision.options.map((option) => {
    const rejectedSuffix =
      option.rejected === true
        ? ` (rejected${option.rejection_reason ? `: ${option.rejection_reason}` : ""})`
        : "";
    return `- ${option.label}${rejectedSuffix}`;
  });
}

function formatCurrentLeaningSection(
  leaning: CurrentDecisionLeaning,
  decision: UnresolvedDecision,
): string[] {
  const optionLabel =
    decision.options.find((option) => option.id === leaning.option_id)?.label ??
    leaning.option_id;
  return [
    "Current leaning, not decided:",
    `- option: ${optionLabel}`,
    `- source_signal_id: ${leaning.source_signal_id}`,
    `- observed_at: ${leaning.observed_at}`,
    `- freshness: ${leaning.freshness}`,
  ];
}

function formatEpisodicLineage(frame: EpisodicFrame): string[] {
  const lineageParts: string[] = [];
  if (frame.provenance.transform_id) {
    lineageParts.push(`transform_id: ${frame.provenance.transform_id}`);
  }
  if (frame.provenance.prompt_version) {
    lineageParts.push(`prompt_version: ${frame.provenance.prompt_version}`);
  }
  if (frame.provenance.model_version) {
    lineageParts.push(`model_version: ${frame.provenance.model_version}`);
  }
  if (frame.source_signals.length > 0) {
    lineageParts.push(`source_signals: ${frame.source_signals.join(", ")}`);
  }
  if (lineageParts.length === 0) {
    return [];
  }
  return ["Lineage:", ...lineageParts.map((part) => `- ${part}`)];
}

/** Format an unresolved decision for runtime projection (never as durable fact). */
export function formatUnresolvedDecisionForRuntime(
  decision: UnresolvedDecision,
  options: FormatUnresolvedDecisionOptions = {},
): RuntimeProjectionFormat | null {
  if (decision.status === "abandoned") {
    return null;
  }

  const heading =
    decision.status === "decided" ? "Decision (resolved)" : "Pending decision";
  const lines: string[] = [
    heading,
    formatScopeLine(decision.scope),
    decision.question,
    decision.status === "decided" ? "Status: Decided" : "Status: Undecided",
  ];

  if (decision.status === "decided" && decision.selected_option_id) {
    const selected = decision.options.find(
      (option) => option.id === decision.selected_option_id,
    );
    lines.push(`Selected: ${selected?.label ?? decision.selected_option_id}`);
  } else {
    lines.push("Options:", ...formatDecisionOptions(decision));
    const leaning = options.currentLeaning;
    if (leaning && leaning.decision_id === decision.id) {
      const includeStale = options.includeStaleLeaning === true;
      if (leaning.freshness === "fresh" || includeStale) {
        lines.push(...formatCurrentLeaningSection(leaning, decision));
      }
    }
  }

  return {
    lines,
    activeInstruction: false,
  };
}

/** Format a runtime preference candidate for projection. */
export function formatRuntimePreferenceCandidateForRuntime(
  preference: RuntimePreferenceCandidate,
  options: FormatRuntimePreferenceOptions = {},
): RuntimeProjectionFormat | null {
  if (preference.status === "promoted" || preference.status === "abandoned") {
    return null;
  }

  const inactive =
    preference.status === "expired" || preference.status === "contradicted";
  if (inactive && options.omitInactive === true) {
    return null;
  }

  const heading =
    preference.mode === "tentative" ? "Tentative preference" : "Runtime preference";
  const lines: string[] = [
    heading,
    formatScopeLine(preference.scope, preference.project_ref),
    preference.statement,
    `confidence: ${preference.confidence}`,
  ];

  if (preference.source_signal_ids.length > 0) {
    lines.push(`source_signal_ids: ${preference.source_signal_ids.join(", ")}`);
  }

  if (preference.mode === "tentative") {
    lines.push("Tentative preference — not durable.");
  }

  if (preference.mode === "time_bounded" && preference.expires_at) {
    lines.push(`expires_at: ${preference.expires_at}`);
  }

  lines.push(
    inactive ? `Status: inactive (${preference.status})` : `Status: ${preference.status}`,
  );

  return {
    lines,
    activeInstruction: preference.status === "active",
  };
}

/** Format a runtime crystal candidate as a provisional working hypothesis. */
export function formatRuntimeCrystalCandidateForRuntime(
  crystal: RuntimeCrystalCandidate,
  _options: FormatRuntimeCrystalOptions = {},
): RuntimeProjectionFormat | null {
  if (crystal.status === "promoted" || crystal.status === "abandoned") {
    return null;
  }

  const lines: string[] = [
    "Working hypothesis",
    formatScopeLine(crystal.scope, crystal.project_ref),
    "Working hypothesis (provisional — not durable fact):",
    crystal.claim,
    `confidence: ${crystal.confidence}`,
    `lineage.generated_by: ${crystal.lineage.generated_by}`,
    `supporting evidence: ${crystal.supporting_evidence_refs.length}`,
    `contradicting evidence: ${crystal.contradicting_evidence_refs.length}`,
    `status: ${crystal.status}`,
  ];

  if (crystal.supporting_evidence_refs.length > 0) {
    lines.push(`supporting refs: ${crystal.supporting_evidence_refs.join(", ")}`);
  }
  if (crystal.contradicting_evidence_refs.length > 0) {
    lines.push(
      `contradicting refs: ${crystal.contradicting_evidence_refs.join(", ")}`,
    );
  }

  return {
    lines,
    activeInstruction: crystal.status === "active" || crystal.status === "supported",
  };
}

/** Format harness operational state with actionable fields only. */
export function formatHarnessOperationalStateForRuntime(
  state: HarnessOperationalState,
  options: FormatHarnessOperationalOptions = {},
): RuntimeProjectionFormat | null {
  if (state.status === "closed") {
    if (options.includeClosed !== true) {
      return null;
    }
    return {
      lines: [
        "Harness operational state",
        ...(state.project_ref ? [formatScopeLine("project", state.project_ref)] : []),
        `Harness: ${state.harness}`,
        "Status: closed (inactive)",
      ],
      activeInstruction: false,
    };
  }

  const lines: string[] = [
    "Harness operational state",
    ...(state.project_ref ? [formatScopeLine("project", state.project_ref)] : []),
    `Harness: ${state.harness}`,
    `Status: ${state.status}`,
  ];

  if (state.cwd) {
    lines.push(`cwd: ${state.cwd}`);
  }
  if (state.branch) {
    lines.push(`branch: ${state.branch}`);
  }
  if (state.active_files && state.active_files.length > 0) {
    lines.push(`active_files: ${state.active_files.join(", ")}`);
  }
  if (state.configured_capabilities && state.configured_capabilities.length > 0) {
    lines.push(
      `configured_capabilities: ${state.configured_capabilities.join(", ")}`,
    );
  }
  if (state.last_successful_action) {
    lines.push(`last_successful_action: ${state.last_successful_action}`);
  }
  if (state.last_failed_action) {
    lines.push(`last_failed_action: ${state.last_failed_action}`);
  }
  if (state.blockers && state.blockers.length > 0) {
    lines.push("Blockers:", ...state.blockers.map((blocker) => `- ${blocker}`));
  }
  if (state.next_agent_instruction) {
    lines.push(`next_agent_instruction: ${state.next_agent_instruction}`);
  }

  return {
    lines,
    activeInstruction: state.status === "active" || state.status === "degraded",
  };
}

/** Format an episodic frame for runtime projection with lifecycle-aware redaction. */
export function formatEpisodicFrameForRuntime(
  frame: EpisodicFrame,
  options: FormatEpisodicFrameOptions = {},
): RuntimeProjectionFormat | null {
  if (frame.lifecycle_state === "deleted") {
    return null;
  }

  if (
    frame.lifecycle_state === "dormant" ||
    frame.lifecycle_state === "deep_dormant"
  ) {
    if (options.includeDormantMetadata !== true) {
      return null;
    }
    return {
      lines: [
        "Episodic frame (dormant metadata)",
        formatScopeLine(frame.scope, frame.project_ref),
        "Dormant metadata:",
        `- frame_id: ${frame.id}`,
        `- lifecycle_state: ${frame.lifecycle_state}`,
        ...(frame.dormant_snapshot_id
          ? [`- dormant_snapshot_id: ${frame.dormant_snapshot_id}`]
          : []),
        `- occurred_at: ${frame.occurred_at}`,
      ],
      activeInstruction: false,
    };
  }

  const lines: string[] = [
    "Episodic frame",
    formatScopeLine(frame.scope, frame.project_ref),
    frame.summary,
    `confidence: ${frame.confidence}`,
    `source: ${frame.source}`,
    ...formatEpisodicLineage(frame),
  ];

  if (frame.sensitivity === "secret_redacted") {
    lines.push("[secret_redacted: details omitted from runtime projection]");
  } else if (frame.sensitivity === "sensitive") {
    lines.push("[sensitive: details omitted from runtime projection]");
  } else if (frame.details && Object.keys(frame.details).length > 0) {
    lines.push("Details omitted from runtime projection.");
  }

  return {
    lines,
    activeInstruction: false,
  };
}

/** Format rejected-signal audit metadata without raw or excerpt content. */
export function formatRejectedSignalLogForRuntime(
  log: RejectedSignalLog,
  _options: FormatRejectedSignalLogOptions = {},
): RuntimeProjectionFormat {
  return {
    lines: [
      "Rejected signal (audit)",
      formatScopeLine(log.scope),
      `rejected_signal_id: ${log.rejected_signal_id}`,
      `timestamp: ${log.timestamp}`,
      `reason_code: ${log.reason_code}`,
      `source_surface: ${log.source_surface}`,
      `source_hash: ${log.source_hash}`,
    ],
    activeInstruction: false,
  };
}

/** Join formatted lines deterministically for display-oriented tests or renderers. */
export function joinRuntimeProjectionLines(lines: readonly string[]): string {
  return lines.join("\n");
}
