/**
 * Claude Code-style preference retrieval API (C4).
 *
 * Falsifiable claim: consolidated preferences are readable from the knowledge
 * store by scope/project filter without a live Claude Code session.
 */

import type { Frame } from "../core/frame-schema.js";
import { isListSuccess, isSearchSuccess } from "../adapter-contract/operation-results.js";
import type { GbrainKnowledgeAdapter } from "../adapters/ssa/gbrain/adapter.js";
import type { KnowledgeStore } from "./storage/knowledge-store.js";

export interface RetrievePreferenceInput {
  scope: Frame["scope"]["kind"];
  projectRef?: string;
  query?: string;
}

export interface RetrievedPreference {
  frame: Frame;
}

export function frameContentMatchesQuery(frame: Frame, query?: string): boolean {
  if (!query) return true;

  const needle = query.toLowerCase();
  const haystack =
    typeof frame.content === "string"
      ? frame.content
      : JSON.stringify(frame.content);
  return haystack.toLowerCase().includes(needle);
}

export function frameMatchesPreferenceInput(frame: Frame, input: RetrievePreferenceInput): boolean {
  if (frame.scope.kind !== input.scope) return false;
  if (input.projectRef && frame.scope.project_ref !== input.projectRef) return false;
  if (frame.curation_mode !== "personal") return false;
  return frameContentMatchesQuery(frame, input.query);
}

export function retrievePreferences(
  knowledge: KnowledgeStore,
  input: RetrievePreferenceInput
): RetrievedPreference[] {
  const frames = knowledge.list({
    scopeKind: input.scope,
    projectRef: input.projectRef,
    curationMode: "personal",
  });

  const filtered = frames.filter((frame) => frameContentMatchesQuery(frame, input.query));

  return filtered.map((frame) => ({ frame }));
}

export async function retrievePreferencesFromGbrain(
  knowledge: GbrainKnowledgeAdapter,
  input: RetrievePreferenceInput
): Promise<RetrievedPreference[]> {
  if (input.query) {
    const searchResult = await knowledge.searchFrames(input.query, { mode: "keyword" });
    if (!isSearchSuccess(searchResult)) {
      throw searchResult.error;
    }
    return searchResult.hits
      .map((hit) => hit.item)
      .filter((frame) => frameMatchesPreferenceInput(frame, input))
      .map((frame) => ({ frame }));
  }

  const listResult = await knowledge.listFrames({
    scopeKind: input.scope,
    projectRef: input.projectRef,
    curationMode: "personal",
  });
  if (!isListSuccess(listResult)) {
    throw listResult.error;
  }
  return listResult.items.map((frame) => ({ frame }));
}

export function retrievePreference(
  knowledge: KnowledgeStore,
  input: RetrievePreferenceInput
): RetrievedPreference | undefined {
  return retrievePreferences(knowledge, input)[0];
}
