/**
 * Cursor-style preference capture API (C3).
 *
 * Falsifiable claim: a scoped preference is enqueued as an EpisodicSignal
 * without touching user-authored harness files.
 */

import { randomUUID } from "node:crypto";

import { projectScopeRequiresRef } from "../core/errors.js";
import type { EpisodicSignal } from "./storage/episodic-signal.js";
import { enqueueEpisodicSignal, RuntimeStore } from "./storage/runtime-store.js";

export interface CapturePreferenceInput {
  content: string;
  scope: EpisodicSignal["scope"];
  projectRef?: string;
  surface?: string;
  capturedAt?: string;
}

export interface CapturePreferenceResult {
  signalId: string;
  queued: true;
}

export function capturePreference(
  runtime: RuntimeStore,
  input: CapturePreferenceInput
): CapturePreferenceResult {
  if (input.scope === "project" && !input.projectRef) {
    throw projectScopeRequiresRef("capturePreference");
  }

  const signalId = randomUUID();
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const surface = input.surface ?? "cursor";
  const signal: EpisodicSignal = {
    id: signalId,
    content: input.content,
    scope: input.scope,
    projectRef: input.projectRef,
    source: {
      surface,
      harness: "cursor",
      captured_at: capturedAt,
    },
  };

  enqueueEpisodicSignal(runtime, signal);
  return { signalId, queued: true };
}
