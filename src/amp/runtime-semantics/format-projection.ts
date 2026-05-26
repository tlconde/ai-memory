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
  EpisodicLifecycleState,
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

export interface FormatHarnessOperationalOptions {
  includeClosed?: boolean;
}

export interface FormatEpisodicFrameOptions {
  includeDormantMetadata?: boolean;
  includeSensitive?: boolean;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled runtime projection case: ${String(value)}`);
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

function formatIncompleteDecidedLines(
  decision: UnresolvedDecision,
  reason: string,
): string[] {
  return [
    "Decision (incomplete)",
    formatScopeLine(decision.scope),
    decision.question,
    `Status: Decided (incomplete — ${reason})`,
  ];
}

function formatCurrentLeaningSection(
  leaning: CurrentDecisionLeaning,
  decision: UnresolvedDecision,
): string[] {
  const matchedOption = decision.options.find(
    (option) => option.id === leaning.option_id,
  );
  if (!matchedOption) {
    return [
      "Current leaning, not decided:",
      "Current leaning references an option not listed on this decision.",
      `- source_signal_id: ${leaning.source_signal_id}`,
      `- observed_at: ${leaning.observed_at}`,
      `- freshness: ${leaning.freshness}`,
    ];
  }
  return [
    "Current leaning, not decided:",
    `- option: ${matchedOption.label}`,
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

function formatEpisodicMetadataOnly(
  frame: EpisodicFrame,
  heading: string,
  note: string,
): RuntimeProjectionFormat {
  return {
    lines: [
      heading,
      formatScopeLine(frame.scope, frame.project_ref),
      `frame_id: ${frame.id}`,
      `event_type: ${frame.event_type}`,
      `occurred_at: ${frame.occurred_at}`,
      `sensitivity: ${frame.sensitivity}`,
      note,
    ],
    activeInstruction: false,
  };
}

function formatOpenDecisionActiveInstruction(
  decision: UnresolvedDecision,
  options: FormatUnresolvedDecisionOptions,
): boolean {
  const leaning = options.currentLeaning;
  if (!leaning || leaning.decision_id !== decision.id) {
    return false;
  }
  if (leaning.freshness !== "fresh") {
    return false;
  }
  const matchedOption = decision.options.find(
    (option) => option.id === leaning.option_id,
  );
  return matchedOption !== undefined;
}

function formatOpenDecisionLines(
  decision: UnresolvedDecision,
  options: FormatUnresolvedDecisionOptions,
): string[] {
  const lines: string[] = [
    "Pending decision",
    formatScopeLine(decision.scope),
    decision.question,
    "Status: Undecided",
    "Options:",
    ...formatDecisionOptions(decision),
  ];

  const leaning = options.currentLeaning;
  if (leaning && leaning.decision_id === decision.id) {
    const includeStale = options.includeStaleLeaning === true;
    if (leaning.freshness === "fresh" || includeStale) {
      lines.push(...formatCurrentLeaningSection(leaning, decision));
    }
  }

  return lines;
}

/** Format an unresolved decision for runtime projection (never as durable fact). */
export function formatUnresolvedDecisionForRuntime(
  decision: UnresolvedDecision,
  options: FormatUnresolvedDecisionOptions = {},
): RuntimeProjectionFormat | null {
  switch (decision.status) {
    case "abandoned":
      return null;
    case "open":
      return {
        lines: formatOpenDecisionLines(decision, options),
        activeInstruction: formatOpenDecisionActiveInstruction(decision, options),
      };
    case "decided": {
      if (!decision.selected_option_id) {
        return {
          lines: formatIncompleteDecidedLines(
            decision,
            "selected_option_id missing",
          ),
          activeInstruction: false,
        };
      }
      const selected = decision.options.find(
        (option) => option.id === decision.selected_option_id,
      );
      if (!selected) {
        return {
          lines: formatIncompleteDecidedLines(
            decision,
            "selected_option_id not in options",
          ),
          activeInstruction: false,
        };
      }
      return {
        lines: [
          "Decision (resolved)",
          formatScopeLine(decision.scope),
          decision.question,
          "Status: Decided",
          `Selected: ${selected.label}`,
        ],
        activeInstruction: false,
      };
    }
    default:
      return assertNever(decision.status);
  }
}

function formatPreferenceBody(
  preference: RuntimePreferenceCandidate,
  statusLabel: string,
): string[] {
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

  lines.push(statusLabel);
  return lines;
}

/** Format a runtime preference candidate for projection. */
export function formatRuntimePreferenceCandidateForRuntime(
  preference: RuntimePreferenceCandidate,
  options: FormatRuntimePreferenceOptions = {},
): RuntimeProjectionFormat | null {
  switch (preference.status) {
    case "promoted":
    case "abandoned":
      return null;
    case "expired":
    case "contradicted":
      if (options.omitInactive === true) {
        return null;
      }
      return {
        lines: formatPreferenceBody(
          preference,
          `Status: inactive (${preference.status})`,
        ),
        activeInstruction: false,
      };
    case "active":
      return {
        lines: formatPreferenceBody(preference, `Status: ${preference.status}`),
        activeInstruction: true,
      };
    default:
      return assertNever(preference.status);
  }
}

function formatCrystalBody(crystal: RuntimeCrystalCandidate): string[] {
  const lines: string[] = [
    "Working hypothesis (provisional — not durable fact)",
    formatScopeLine(crystal.scope, crystal.project_ref),
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

  return lines;
}

/** Format a runtime crystal candidate as a provisional working hypothesis. */
export function formatRuntimeCrystalCandidateForRuntime(
  crystal: RuntimeCrystalCandidate,
): RuntimeProjectionFormat | null {
  switch (crystal.status) {
    case "promoted":
    case "abandoned":
      return null;
    case "active":
    case "supported":
      return {
        lines: formatCrystalBody(crystal),
        activeInstruction: true,
      };
    case "refuted":
    case "stale":
      return {
        lines: formatCrystalBody(crystal),
        activeInstruction: false,
      };
    default:
      return assertNever(crystal.status);
  }
}

function formatHarnessHeaderLines(
  state: HarnessOperationalState,
  statusLine: string,
): string[] {
  return [
    "Harness operational state",
    ...(state.project_ref ? [formatScopeLine("project", state.project_ref)] : []),
    `Harness: ${state.harness}`,
    statusLine,
  ];
}

function formatHarnessActionableLines(state: HarnessOperationalState): string[] {
  const lines = formatHarnessHeaderLines(state, `Status: ${state.status}`);

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

  return lines;
}

/** Format harness operational state with actionable fields only. */
export function formatHarnessOperationalStateForRuntime(
  state: HarnessOperationalState,
  options: FormatHarnessOperationalOptions = {},
): RuntimeProjectionFormat | null {
  switch (state.status) {
    case "closed":
      if (options.includeClosed !== true) {
        return null;
      }
      return {
        lines: formatHarnessHeaderLines(state, "Status: closed (inactive)"),
        activeInstruction: false,
      };
    case "active":
    case "degraded":
      return {
        lines: formatHarnessActionableLines(state),
        activeInstruction: true,
      };
    case "unavailable":
      return {
        lines: formatHarnessActionableLines(state),
        activeInstruction: false,
      };
    default:
      return assertNever(state.status);
  }
}

function formatActiveEpisodicFrame(
  frame: EpisodicFrame,
  options: FormatEpisodicFrameOptions,
): RuntimeProjectionFormat {
  if (frame.sensitivity === "secret_redacted") {
    return formatEpisodicMetadataOnly(
      frame,
      "Episodic frame (metadata only)",
      "[secret_redacted: summary and details omitted from runtime projection]",
    );
  }

  if (frame.sensitivity === "sensitive" && options.includeSensitive !== true) {
    return formatEpisodicMetadataOnly(
      frame,
      "Episodic frame (metadata only)",
      "[sensitive: summary and details omitted from runtime projection]",
    );
  }

  const lines: string[] = [
    "Episodic frame",
    formatScopeLine(frame.scope, frame.project_ref),
    frame.summary,
    `confidence: ${frame.confidence}`,
    `source: ${frame.source}`,
    ...formatEpisodicLineage(frame),
  ];

  if (frame.sensitivity === "sensitive") {
    lines.push("[sensitive: details omitted from runtime projection]");
  } else if (frame.details && Object.keys(frame.details).length > 0) {
    lines.push("Details omitted from runtime projection.");
  }

  return {
    lines,
    activeInstruction: false,
  };
}

function formatDormantEpisodicFrame(
  frame: EpisodicFrame,
): RuntimeProjectionFormat {
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

/** Format an episodic frame for runtime projection with lifecycle-aware redaction. */
export function formatEpisodicFrameForRuntime(
  frame: EpisodicFrame,
  options: FormatEpisodicFrameOptions = {},
): RuntimeProjectionFormat | null {
  const lifecycleState: EpisodicLifecycleState = frame.lifecycle_state;
  switch (lifecycleState) {
    case "deleted":
      return null;
    case "dormant":
    case "deep_dormant":
      if (options.includeDormantMetadata !== true) {
        return null;
      }
      return formatDormantEpisodicFrame(frame);
    case "active":
      return formatActiveEpisodicFrame(frame, options);
    default:
      return assertNever(lifecycleState);
  }
}

/** Format rejected-signal audit metadata without raw or excerpt content. */
export function formatRejectedSignalLogForRuntime(
  log: RejectedSignalLog,
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
