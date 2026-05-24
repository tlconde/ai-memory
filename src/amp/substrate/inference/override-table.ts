/**
 * Deterministic per-scope override table derived from correction frames.
 *
 * Falsifiable claim: lookup by classifier + context fingerprint returns the
 * latest corrected output without model fine-tuning.
 */

import type { Frame } from "../../core/frame-schema.js";
import type { ScopeBlock } from "../../core/frame-schema.js";
import { readCorrectionFrameContent } from "../../core/correction-frame.js";

export const OVERRIDE_TABLE_SCHEMA_VERSION = "1.0";

export interface DeterministicOverrideEntry {
  classifier: string;
  contextFingerprint: string;
  previousOutput: unknown;
  correctedOutput: unknown;
  correctionFrameId: string;
  correctedAt: string;
}

export interface DeterministicOverrideTable {
  schema_version: typeof OVERRIDE_TABLE_SCHEMA_VERSION;
  scope: ScopeBlock;
  entries: Record<string, DeterministicOverrideEntry>;
}

export interface OverrideLookupInput {
  classifier: string;
  contextFingerprint: string;
  previousOutput?: unknown;
}

export interface OverrideLookupResult {
  hit: boolean;
  correctedOutput?: unknown;
  entry?: DeterministicOverrideEntry;
}

/** Stable lookup key for classifier + context fingerprint pairs. */
export function overrideLookupKey(classifier: string, contextFingerprint: string): string {
  return `${classifier}\u0000${contextFingerprint}`;
}

export function createEmptyOverrideTable(scope: ScopeBlock): DeterministicOverrideTable {
  return {
    schema_version: OVERRIDE_TABLE_SCHEMA_VERSION,
    scope,
    entries: {},
  };
}

function entryFromCorrectionFrame(frame: Frame): DeterministicOverrideEntry | undefined {
  const content = readCorrectionFrameContent(frame);
  if (!content) return undefined;

  return {
    classifier: content.classifier,
    contextFingerprint: content.context_fingerprint,
    previousOutput: content.previous_output,
    correctedOutput: content.corrected_output,
    correctionFrameId: frame.id,
    correctedAt: frame.created_at,
  };
}

/** Merge one correction frame; later `created_at` wins for the same lookup key. */
export function applyCorrectionToOverrideTable(
  table: DeterministicOverrideTable,
  correctionFrame: Frame
): DeterministicOverrideTable {
  const entry = entryFromCorrectionFrame(correctionFrame);
  if (!entry) return table;

  const key = overrideLookupKey(entry.classifier, entry.contextFingerprint);
  const existing = table.entries[key];
  if (existing && existing.correctedAt > entry.correctedAt) {
    return table;
  }

  return {
    ...table,
    entries: {
      ...table.entries,
      [key]: entry,
    },
  };
}

/** Build a table from correction frames in encounter order (later timestamps win). */
export function buildOverrideTableFromCorrections(
  scope: ScopeBlock,
  correctionFrames: Frame[]
): DeterministicOverrideTable {
  let table = createEmptyOverrideTable(scope);
  const ordered = [...correctionFrames].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const frame of ordered) {
    table = applyCorrectionToOverrideTable(table, frame);
  }
  return table;
}

function outputsMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Deterministic lookup: requires previousOutput match when provided. */
export function lookupOverride(
  table: DeterministicOverrideTable,
  input: OverrideLookupInput
): OverrideLookupResult {
  const key = overrideLookupKey(input.classifier, input.contextFingerprint);
  const entry = table.entries[key];
  if (!entry) {
    return { hit: false };
  }

  if (input.previousOutput !== undefined && !outputsMatch(entry.previousOutput, input.previousOutput)) {
    return { hit: false };
  }

  return {
    hit: true,
    correctedOutput: entry.correctedOutput,
    entry,
  };
}
