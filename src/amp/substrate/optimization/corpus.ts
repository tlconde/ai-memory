/**
 * Map correction episodic frames to optimization corpus entries.
 */

import type { RuntimeSemanticEntityRecord } from "../../runtime-semantics/entity-record.js";
import { parseEpisodicFrame, type EpisodicFrame } from "../../runtime-semantics/schema.js";
import type { CorrectionCorpusEntry } from "./types.js";
import { CorrectionCorpusEntrySchema } from "./types.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

/** Map one correction episodic frame to a corpus entry when skill metadata is present. */
export function mapCorrectionFrameToCorpusEntry(frame: EpisodicFrame): CorrectionCorpusEntry | undefined {
  if (frame.event_type !== "correction") {
    return undefined;
  }

  const details = frame.details ?? {};
  const skillName = asString(details.skill_name);
  if (!skillName) {
    return undefined;
  }

  return CorrectionCorpusEntrySchema.parse({
    id: frame.id,
    skillName,
    summary: frame.summary,
    expectedBehavior: asString(details.expected_behavior),
    avoidPhrase: asString(details.avoid_phrase),
    mustContain: asStringArray(details.qrel_must_contain),
    mustNotContain: asStringArray(details.qrel_must_not_contain),
    occurredAt: frame.occurred_at,
    holdout: details.holdout === true,
  });
}

/** Extract optimization corpus entries for a skill from typed runtime rows. */
export function corpusEntriesForSkill(
  records: readonly RuntimeSemanticEntityRecord[],
  skillName: string
): CorrectionCorpusEntry[] {
  const entries: CorrectionCorpusEntry[] = [];

  for (const record of records) {
    if (record.kind !== "episodic-frame") {
      continue;
    }

    const frame = parseEpisodicFrame(record.payload);
    const mapped = mapCorrectionFrameToCorpusEntry(frame);
    if (mapped && mapped.skillName === skillName) {
      entries.push(mapped);
    }
  }

  entries.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  return entries;
}

/** Build an in-memory corpus entry for tests and fixtures. */
export function createCorpusEntry(
  overrides: Partial<CorrectionCorpusEntry> & Pick<CorrectionCorpusEntry, "id" | "skillName" | "summary">
): CorrectionCorpusEntry {
  return CorrectionCorpusEntrySchema.parse({
    occurredAt: "2026-05-29T10:00:00.000Z",
    mustContain: [],
    mustNotContain: [],
    holdout: false,
    ...overrides,
  });
}
