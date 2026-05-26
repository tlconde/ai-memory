/**
 * Pure runtime capture exclusion filter (RUNTIME-06).
 *
 * Falsifiable claim: excluded runtime signals fail closed with stable reason codes
 * and audit metadata without persisting raw sensitive content.
 *
 * Policy source: amp-runtime-episodic-semantics.md Topic 1.I — Runtime Exclusion List.
 */

import { createHash } from "node:crypto";

import type { ScopeKind } from "../core/frame-schema.js";
import { AMP_LOCAL_DIR_REL, AMP_RUNTIME_DIR_REL } from "../gitignore/paths.js";
import type { RuntimeSemanticEntityRecord } from "./entity-record.js";

/** Stable rejection reason codes aligned with runtime episodic semantics Topic 1.I. */
export const RUNTIME_CAPTURE_REJECTION_REASON_CODES = [
  "credentials_or_secrets",
  "irrelevant_private_pii",
  "inferred_emotional_state",
  "telemetry_without_semantic_content",
  "verbatim_long_content",
  "third_party_confidential_content",
  "runtime_safety_policy_violation",
  "speculative_identity_claim",
  "unsourced_domain_conclusion",
] as const;

export type RuntimeCaptureRejectionReasonCode =
  (typeof RUNTIME_CAPTURE_REJECTION_REASON_CODES)[number];

/** Maximum raw signal length eligible for runtime capture without verbatim rejection. */
export const RUNTIME_CAPTURE_VERBATIM_MAX_CHARS = 4_096;

/** Maximum redacted audit excerpt length stored on rejected-signal-log rows. */
export const RUNTIME_CAPTURE_REDACTED_EXCERPT_MAX_CHARS = 120;

export type RuntimeCaptureExclusionHint = RuntimeCaptureRejectionReasonCode;

export interface RuntimeCaptureSignalInput {
  /** Raw signal body evaluated for exclusion (never persisted on reject). */
  content: string;
  sourceSurface: string;
  scope: ScopeKind;
  projectRef?: string;
  /** Optional upstream classifier hint; honored when it maps to a known reason code. */
  exclusionHint?: RuntimeCaptureExclusionHint;
  /**
   * When provided and the signal passes exclusion, echoed in the accept result as a
   * capture-eligible typed record for downstream writers.
   */
  captureRecord?: RuntimeSemanticEntityRecord;
}

export interface RuntimeCaptureAcceptedSignal {
  content: string;
  source_surface: string;
  source_hash: string;
  scope: ScopeKind;
  project_ref?: string;
  captureRecord?: RuntimeSemanticEntityRecord;
}

export interface RuntimeCaptureRejectionAudit {
  reason_code: RuntimeCaptureRejectionReasonCode;
  source_surface: string;
  source_hash: string;
  scope: ScopeKind;
  project_ref?: string;
  redacted_excerpt?: string;
}

export type RuntimeCaptureExclusionFilterResult =
  | { ok: true; accepted: RuntimeCaptureAcceptedSignal }
  | { ok: false; rejected: RuntimeCaptureRejectionAudit };

const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bsk-[a-zA-Z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[a-zA-Z0-9]{36}\b/,
  /\bgho_[a-zA-Z0-9]{36}\b/,
  /\bxox[baprs]-[a-zA-Z0-9-]{10,}\b/,
  /\bBearer\s+[a-zA-Z0-9._-]{8,}\b/i,
  /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*\S+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

const PRIVATE_PII_PATTERNS: readonly RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b(?:\d{4}[\s-]?){3}\d{4}\b/,
];

const INFERRED_EMOTION_PATTERNS: readonly RegExp[] = [
  /\b(?:user|they|operator)\s+(?:seems|appears|looks|is)\s+(?:frustrated|angry|upset|annoyed|sad|depressed|anxious|happy|excited)\b/i,
  /\binferred\s+(?:emotional|emotion|mood|affect)\b/i,
  /\b(?:emotional|mood)\s+state\s*:\s*/i,
];

const TELEMETRY_PATTERNS: readonly RegExp[] = [
  /^\s*\{[\s\S]*\}\s*$/,
  /^\s*[\d\s:.,[\]{}"/\\+=\-|%]+$/,
  /\b(?:latency_ms|cpu_percent|mem_bytes|request_count|p\d{2})\s*[:=]\s*[\d.]+(?:\s|$)/i,
];

const THIRD_PARTY_CONFIDENTIAL_PATTERNS: readonly RegExp[] = [
  /\b(?:confidential|under nda|do not distribute|privileged and confidential)\b/i,
  /"[^"]{500,}"/,
  /'[^']{500,}'/,
];

const RUNTIME_SAFETY_PATTERNS: readonly RegExp[] = [
  new RegExp(`${escapeForRegExp(AMP_LOCAL_DIR_REL)}\\S*`, "i"),
  new RegExp(`${escapeForRegExp(AMP_RUNTIME_DIR_REL)}\\S*`, "i"),
  /\.amp\/(?:local|runtime)\/\S*/i,
];

const SPECULATIVE_IDENTITY_PATTERNS: readonly RegExp[] = [
  /\b(?:user|they|operator)\s+(?:is probably|likely is|must be)\s+(?:an?\s+)?(?:introvert|extrovert|narcissist|genius|lazy|incompetent)\b/i,
  /\binferred\s+(?:personality|identity|temperament)\b/i,
];

const UNSOURCED_DOMAIN_CONCLUSION_PATTERNS: readonly RegExp[] = [
  /\b(?:diagnosed with|has(?: the)?(?: legal| medical| financial)?(?: diagnosis| condition| liability|risk))\b/i,
  /\b(?:legally|medically|financially)\s+(?:liable|obligated|bankrupt|insolvent)\b/i,
];

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Compute a stable SHA-256 audit hash for one capture signal body. */
export function computeRuntimeCaptureSourceHash(content: string): string {
  const digest = createHash("sha256").update(content).digest("hex");
  return `sha256:${digest}`;
}

/** Build a redacted excerpt safe for rejected-signal audit rows. */
export function redactRuntimeCaptureExcerpt(content: string): string | undefined {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  let excerpt = trimmed;
  for (const pattern of CREDENTIAL_PATTERNS) {
    excerpt = excerpt.replace(pattern, "[REDACTED]");
  }
  for (const pattern of PRIVATE_PII_PATTERNS) {
    excerpt = excerpt.replace(pattern, "[REDACTED]");
  }

  if (excerpt.length <= RUNTIME_CAPTURE_REDACTED_EXCERPT_MAX_CHARS) {
    return excerpt;
  }

  return `${excerpt.slice(0, RUNTIME_CAPTURE_REDACTED_EXCERPT_MAX_CHARS - 1)}…`;
}

function matchesAny(content: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(content));
}

function looksLikeTelemetryOnly(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return false;
  }

  if (!matchesAny(trimmed, TELEMETRY_PATTERNS)) {
    return false;
  }

  const alphaWords = trimmed.match(/\b[a-zA-Z]{4,}\b/g) ?? [];
  const semanticWords = alphaWords.filter(
    (word) => !/^(?:latency|cpu|mem|bytes|count|percent|request|p\d{2})$/i.test(word),
  );
  return semanticWords.length === 0;
}

function detectExclusionReason(
  content: string,
  hint?: RuntimeCaptureExclusionHint,
): RuntimeCaptureRejectionReasonCode | undefined {
  if (hint !== undefined) {
    return hint;
  }

  if (matchesAny(content, CREDENTIAL_PATTERNS)) {
    return "credentials_or_secrets";
  }

  if (matchesAny(content, RUNTIME_SAFETY_PATTERNS)) {
    return "runtime_safety_policy_violation";
  }

  if (matchesAny(content, INFERRED_EMOTION_PATTERNS)) {
    return "inferred_emotional_state";
  }

  if (looksLikeTelemetryOnly(content)) {
    return "telemetry_without_semantic_content";
  }

  if (matchesAny(content, PRIVATE_PII_PATTERNS)) {
    return "irrelevant_private_pii";
  }

  if (content.length > RUNTIME_CAPTURE_VERBATIM_MAX_CHARS) {
    return "verbatim_long_content";
  }

  if (matchesAny(content, THIRD_PARTY_CONFIDENTIAL_PATTERNS)) {
    return "third_party_confidential_content";
  }

  if (matchesAny(content, SPECULATIVE_IDENTITY_PATTERNS)) {
    return "speculative_identity_claim";
  }

  if (matchesAny(content, UNSOURCED_DOMAIN_CONCLUSION_PATTERNS)) {
    return "unsourced_domain_conclusion";
  }

  return undefined;
}

function buildRejectionAudit(
  input: RuntimeCaptureSignalInput,
  reasonCode: RuntimeCaptureRejectionReasonCode,
): RuntimeCaptureRejectionAudit {
  const projectRef = input.projectRef?.trim();
  const redactedExcerpt = shouldIncludeRedactedExcerpt(reasonCode)
    ? redactRuntimeCaptureExcerpt(input.content)
    : undefined;
  return {
    reason_code: reasonCode,
    source_surface: input.sourceSurface,
    source_hash: computeRuntimeCaptureSourceHash(input.content),
    scope: input.scope,
    ...(projectRef ? { project_ref: projectRef } : {}),
    ...(redactedExcerpt ? { redacted_excerpt: redactedExcerpt } : {}),
  };
}

function shouldIncludeRedactedExcerpt(
  reasonCode: RuntimeCaptureRejectionReasonCode,
): boolean {
  switch (reasonCode) {
    case "credentials_or_secrets":
    case "irrelevant_private_pii":
    case "runtime_safety_policy_violation":
      return true;
    case "inferred_emotional_state":
    case "telemetry_without_semantic_content":
    case "verbatim_long_content":
    case "third_party_confidential_content":
    case "speculative_identity_claim":
    case "unsourced_domain_conclusion":
      return false;
    default: {
      const _exhaustive: never = reasonCode;
      void _exhaustive;
      return false;
    }
  }
}

function buildAcceptedSignal(input: RuntimeCaptureSignalInput): RuntimeCaptureAcceptedSignal {
  const projectRef = input.projectRef?.trim();
  return {
    content: input.content,
    source_surface: input.sourceSurface,
    source_hash: computeRuntimeCaptureSourceHash(input.content),
    scope: input.scope,
    ...(projectRef ? { project_ref: projectRef } : {}),
    ...(input.captureRecord ? { captureRecord: input.captureRecord } : {}),
  };
}

/** Evaluate one runtime capture signal against the Topic 1.I exclusion list. */
export function evaluateRuntimeCaptureExclusionFilter(
  input: RuntimeCaptureSignalInput,
): RuntimeCaptureExclusionFilterResult {
  const content = input.content;
  if (content.trim().length === 0) {
    return {
      ok: false,
      rejected: buildRejectionAudit(input, "telemetry_without_semantic_content"),
    };
  }

  const reasonCode = detectExclusionReason(content, input.exclusionHint);
  if (reasonCode !== undefined) {
    return {
      ok: false,
      rejected: buildRejectionAudit(input, reasonCode),
    };
  }

  return {
    ok: true,
    accepted: buildAcceptedSignal(input),
  };
}
