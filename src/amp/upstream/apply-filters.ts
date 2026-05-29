/**
 * Apply-target filtering for upstream changesets (names and §16.5 categories).
 */

import type { PersistedUpstreamChangeset } from "./types.js";

const APPLY_CATEGORY_TOKENS = new Set(["added", "updated", "removed"]);

/** Expand `--only added|updated|removed` into procedure name targets. */
export function expandApplyOnlyFilter(
  changeset: PersistedUpstreamChangeset,
  only?: readonly string[]
): readonly string[] | undefined {
  if (!only || only.length === 0) {
    return undefined;
  }

  const expanded = new Set<string>();
  for (const token of only) {
    if (token === "added") {
      for (const entry of changeset.added) {
        expanded.add(entry.id);
      }
    } else if (token === "updated") {
      for (const entry of changeset.updated) {
        expanded.add(entry.id);
      }
    } else if (token === "removed") {
      for (const entry of changeset.removed) {
        expanded.add(entry.id);
      }
    } else {
      expanded.add(token);
    }
  }

  return [...expanded];
}

export function matchesApplyNameFilter(
  name: string,
  only?: readonly string[],
  exclude?: readonly string[]
): boolean {
  if (only && only.length > 0 && !only.includes(name)) {
    return false;
  }
  if (exclude && exclude.some((pattern) => name.includes(pattern.replace(/\*/g, "")))) {
    return false;
  }
  return true;
}

/** Resolve apply targets from a changeset honoring name and category filters. */
export function resolveApplyTargetNames(
  changeset: PersistedUpstreamChangeset,
  only?: readonly string[],
  exclude?: readonly string[]
): string[] {
  const expandedOnly = expandApplyOnlyFilter(changeset, only);
  return [
    ...changeset.added.map((entry) => entry.id),
    ...changeset.updated.map((entry) => entry.id),
  ].filter((name) => matchesApplyNameFilter(name, expandedOnly, exclude));
}

/** True when the changeset still has applyable entries not in `applied`. */
export function changesetHasRemainingApplyTargets(
  changeset: PersistedUpstreamChangeset,
  applied: readonly string[]
): boolean {
  const appliedSet = new Set(applied);
  const remaining = [
    ...changeset.added.map((entry) => entry.id),
    ...changeset.updated.map((entry) => entry.id),
  ];
  return remaining.some((name) => !appliedSet.has(name));
}

export function isApplyCategoryToken(token: string): boolean {
  return APPLY_CATEGORY_TOKENS.has(token);
}
