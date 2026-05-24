/**
 * Claude Code-style preference retrieval API (C4).
 *
 * Falsifiable claim: consolidated preferences are readable from the knowledge
 * store by scope/project filter without a live Claude Code session.
 */

import type { Frame } from "../core/frame-schema.js";
import type { KnowledgeStore } from "./storage/knowledge-store.js";

export interface RetrievePreferenceInput {
  scope: Frame["scope"]["kind"];
  projectRef?: string;
  query?: string;
}

export interface RetrievedPreference {
  frame: Frame;
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

  const filtered = input.query
    ? frames.filter((frame) =>
        typeof frame.content === "string"
          ? frame.content.toLowerCase().includes(input.query!.toLowerCase())
          : JSON.stringify(frame.content).toLowerCase().includes(input.query!.toLowerCase())
      )
    : frames;

  return filtered.map((frame) => ({ frame }));
}

export function retrievePreference(
  knowledge: KnowledgeStore,
  input: RetrievePreferenceInput
): RetrievedPreference | undefined {
  return retrievePreferences(knowledge, input)[0];
}
