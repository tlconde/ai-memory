/**
 * Unsupported capability errors for adapter contract operations.
 *
 * Falsifiable claim: calling an unsupported capability returns a structured
 * AmpError with CAPABILITY_NOT_SUPPORTED rather than silent no-ops.
 */

import { AmpErrorCode, capabilityNotSupported, isAmpError, type AmpError } from "../core/errors.js";
import {
  isCapabilitySupported,
  type CapabilityCoverage,
  type CapabilityLevel,
} from "./capability-coverage.js";
import type { ListResult, MutateResult, ReadResult, SearchResult, WriteResult } from "./operation-results.js";
import {
  listFailure,
  mutateFailure,
  readFailure,
  searchFailure,
  writeFailure,
} from "./operation-results.js";

export type CapabilityFeature = keyof CapabilityCoverage;

export type UnsupportedCapabilityResult<TItem = never> =
  | ReadResult<TItem>
  | WriteResult
  | SearchResult<TItem>
  | MutateResult<TItem>
  | ListResult<TItem>;

export function unsupportedCapabilityError(feature: string): AmpError {
  return capabilityNotSupported(feature);
}

export function checkCapabilityOrError(
  coverage: CapabilityCoverage,
  feature: CapabilityFeature
): AmpError | undefined {
  if (isCapabilitySupported(coverage, feature)) {
    return undefined;
  }
  return unsupportedCapabilityError(formatCapabilityFeature(coverage, feature));
}

export function assertCapabilitySupported(
  coverage: CapabilityCoverage,
  feature: CapabilityFeature
): void {
  const error = checkCapabilityOrError(coverage, feature);
  if (error) {
    throw error;
  }
}

export function unsupportedReadResult<TItem>(feature: string): ReadResult<TItem> {
  return readFailure(unsupportedCapabilityError(feature));
}

export function unsupportedWriteResult(feature: string): WriteResult {
  return writeFailure(unsupportedCapabilityError(feature));
}

export function unsupportedSearchResult<TItem>(feature: string): SearchResult<TItem> {
  return searchFailure(unsupportedCapabilityError(feature));
}

export function unsupportedMutateResult<TItem>(feature: string): MutateResult<TItem> {
  return mutateFailure(unsupportedCapabilityError(feature));
}

export function unsupportedListResult<TItem>(feature: string): ListResult<TItem> {
  return listFailure(unsupportedCapabilityError(feature));
}

export function isUnsupportedCapabilityResult(result: {
  success: false;
  error: unknown;
}): boolean {
  if (result.success !== false) return false;
  return isAmpError(result.error) && result.error.code === AmpErrorCode.CAPABILITY_NOT_SUPPORTED;
}

function formatCapabilityFeature(
  coverage: CapabilityCoverage,
  feature: CapabilityFeature
): string {
  const level = coverage[feature];
  if (typeof level === "string") {
    return feature;
  }
  if (typeof level === "object" && level !== null) {
    const unsupportedKinds = Object.entries(level as Record<string, CapabilityLevel>)
      .filter(([, value]) => value === "unsupported")
      .map(([kind]) => kind);
    if (unsupportedKinds.length > 0) {
      return `${feature}.${unsupportedKinds.join(",")}`;
    }
  }
  return String(feature);
}
