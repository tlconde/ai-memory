/**
 * `amp stack setup plan` — read-only operator setup plan for the AMP scaffold.
 *
 * Falsifiable claim: setup planning reuses stack verification status and emits
 * ordered next actions without installing, configuring, or opening knowledge.db.
 */

import {
  runAmpStackVerify,
  type AmpStackStatusComponent,
  type AmpStackStatusOptions,
  type AmpStackVerifyCheck,
  type AmpStackVerifyResult,
} from "./stack-status.js";

export type AmpStackSetupActionStatus = "done" | "todo" | "blocked";
export type AmpStackSetupActionRisk = "none" | "low" | "medium" | "high";

export interface AmpStackSetupAction {
  id: string;
  label: string;
  status: AmpStackSetupActionStatus;
  command: string;
  reason: string;
  risk: AmpStackSetupActionRisk;
  automatable: boolean;
}

export interface AmpStackSetupPlanOptions extends AmpStackStatusOptions {}

export interface AmpStackSetupPlanResult {
  ok: boolean;
  projectRoot: string;
  primaryBackend: "gbrain";
  evaluatedKnowledgeBackend: AmpStackVerifyResult["evaluatedKnowledgeBackend"];
  actions: AmpStackSetupAction[];
  doneCount: number;
  todoCount: number;
  blockedCount: number;
  verification: AmpStackVerifyResult;
  error?: string;
}

function findComponent(
  verification: AmpStackVerifyResult,
  id: string
): AmpStackStatusComponent | undefined {
  return verification.status.components.find((component) => component.id === id);
}

function findCheck(
  verification: AmpStackVerifyResult,
  id: string
): AmpStackVerifyCheck | undefined {
  return verification.checks.find((check) => check.id === id);
}

function action(ctx: AmpStackSetupAction): AmpStackSetupAction {
  return ctx;
}

function countActions(
  actions: readonly AmpStackSetupAction[],
  status: AmpStackSetupActionStatus
): number {
  return actions.filter((entry) => entry.status === status).length;
}

function actionStatusFromCheck(check: AmpStackVerifyCheck | undefined): AmpStackSetupActionStatus {
  if (!check || check.status === "fail") {
    return "blocked";
  }
  return check.status === "pass" ? "done" : "todo";
}

function appendBackendAction(
  actions: AmpStackSetupAction[],
  verification: AmpStackVerifyResult
): void {
  const check = findCheck(verification, "backend-selection");
  if (check?.status !== "fail") {
    return;
  }

  actions.push(
    action({
      id: "backend-selection",
      label: "Choose a supported knowledge backend",
      status: "blocked",
      command: "amp stack setup plan --knowledge gbrain",
      reason: check.message,
      risk: "none",
      automatable: false,
    })
  );
}

function appendGbrainAction(
  actions: AmpStackSetupAction[],
  verification: AmpStackVerifyResult
): void {
  const check = findCheck(verification, "gbrain-readiness");
  if (check?.status === "pass") {
    actions.push(
      action({
        id: "gbrain-readiness",
        label: "Verify GBrain as the primary backend",
        status: "done",
        command: "amp stack verify --profile gbrain-live --knowledge gbrain",
        reason: "GBrain read-only probes passed.",
        risk: "none",
        automatable: false,
      })
    );
    return;
  }

  actions.push(
    action({
      id: "gbrain-readiness",
      label: "Install or configure GBrain",
      status: actionStatusFromCheck(check),
      command: "amp gbrain-preflight --knowledge gbrain",
      reason: check?.message ?? "GBrain verification check is missing.",
      risk: "low",
      automatable: false,
    })
  );
}

function appendLocalKnowledgeAction(
  actions: AmpStackSetupAction[],
  verification: AmpStackVerifyResult
): void {
  const check = findCheck(verification, "local-knowledge");
  if (check?.status === "pass") {
    actions.push(
      action({
        id: "local-knowledge",
        label: "Inspect durable local knowledge",
        status: "done",
        command: "amp knowledge status",
        reason: "knowledge.db exists beside runtime.db.",
        risk: "none",
        automatable: true,
      })
    );
    return;
  }

  actions.push(
    action({
      id: "local-knowledge",
      label: "Create durable local knowledge.db",
      status: actionStatusFromCheck(check),
      command: "amp consolidate",
      reason: check?.message ?? "Local durable knowledge check is missing.",
      risk: "low",
      automatable: false,
    })
  );
}

function appendHermesAction(
  actions: AmpStackSetupAction[],
  verification: AmpStackVerifyResult
): void {
  const hermes = findComponent(verification, "hermes");
  if (hermes?.status === "ready") {
    actions.push(
      action({
        id: "hermes",
        label: "Confirm Hermes skill discovery",
        status: "done",
        command: "hermes -s",
        reason: hermes.summary,
        risk: "none",
        automatable: false,
      })
    );
    return;
  }

  actions.push(
    action({
      id: "hermes",
      label: "Wire Hermes skill discovery",
      status: hermes?.status === "blocked" ? "blocked" : "todo",
      command: "hermes -s",
      reason: hermes?.summary ?? "Hermes discovery component is missing.",
      risk: "low",
      automatable: false,
    })
  );
}

function appendAgentAction(
  actions: AmpStackSetupAction[],
  verification: AmpStackVerifyResult
): void {
  const check = findCheck(verification, "agent-wiring");
  if (check?.status === "pass") {
    actions.push(
      action({
        id: "agent-wiring",
        label: "Confirm agent wiring",
        status: "done",
        command: "amp agent setup --target codex --dry-run",
        reason: "Agent wiring checks passed.",
        risk: "none",
        automatable: true,
      })
    );
    return;
  }

  actions.push(
    action({
      id: "agent-wiring",
      label: "Plan agent setup",
      status: actionStatusFromCheck(check),
      command: "amp agent setup --target codex --dry-run",
      reason: check?.message ?? "Agent wiring verification check is missing.",
      risk: "low",
      automatable: true,
    })
  );
}

function appendVerificationAction(
  actions: AmpStackSetupAction[],
  verification: AmpStackVerifyResult
): void {
  actions.push(
    action({
      id: "stack-verify",
      label: "Run stack verification gates",
      status: verification.ok ? "done" : "blocked",
      command: "amp stack verify",
      reason: verification.ok
        ? "Stack verification has no blocking failures."
        : verification.error ?? "Stack verification found blocking checks.",
      risk: "none",
      automatable: true,
    })
  );
}

/** Build an ordered, read-only setup plan for the AMP scaffold/control plane. */
export function runAmpStackSetupPlan(
  options: AmpStackSetupPlanOptions = {}
): AmpStackSetupPlanResult {
  const verification = runAmpStackVerify(options);
  const actions: AmpStackSetupAction[] = [];

  appendBackendAction(actions, verification);
  appendGbrainAction(actions, verification);
  appendLocalKnowledgeAction(actions, verification);
  appendHermesAction(actions, verification);
  appendAgentAction(actions, verification);
  appendVerificationAction(actions, verification);

  const blockedCount = countActions(actions, "blocked");
  const result: AmpStackSetupPlanResult = {
    ok: blockedCount === 0,
    projectRoot: verification.projectRoot,
    primaryBackend: verification.primaryBackend,
    evaluatedKnowledgeBackend: verification.evaluatedKnowledgeBackend,
    actions,
    doneCount: countActions(actions, "done"),
    todoCount: countActions(actions, "todo"),
    blockedCount,
    verification,
  };

  if (!result.ok) {
    result.error = "Stack setup plan has blocked actions.";
  }

  return result;
}

/** JSON payload for `amp stack setup plan --json`. */
export function formatAmpStackSetupPlanJson(result: AmpStackSetupPlanResult): string {
  return JSON.stringify({ ...result, error: result.error ?? null }, null, 2);
}

/** Human-readable stack setup plan report lines. */
export function formatAmpStackSetupPlanReport(result: AmpStackSetupPlanResult): string[] {
  const lines = [
    `AMP stack setup plan - ${result.projectRoot}`,
    "",
    "  mode: read-only",
    `  primaryBackend: ${result.primaryBackend}`,
    `  evaluatedKnowledgeBackend: ${result.evaluatedKnowledgeBackend}`,
    `  summary: ${result.doneCount} done, ${result.todoCount} todo, ${result.blockedCount} blocked`,
    "",
    "Actions:",
  ];

  for (const entry of result.actions) {
    lines.push(`  ${entry.status.toUpperCase()} [${entry.id}] ${entry.label}`);
    lines.push(`    command: ${entry.command}`);
    lines.push(`    reason: ${entry.reason}`);
    lines.push(`    risk: ${entry.risk}; automatable: ${entry.automatable}`);
  }

  lines.push("");
  if (result.ok) {
    lines.push("OK Stack setup plan complete — no blocked actions.");
  } else {
    lines.push(`ERROR ${result.error ?? "Stack setup plan has blocked actions."}`);
  }

  return lines;
}
