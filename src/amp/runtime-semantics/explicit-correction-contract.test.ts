import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Command } from "commander";

import { registerAmpCommands } from "../cli/index.js";
import { formatEpisodicFrameForRuntime } from "./format-projection.js";
import {
  EPISODIC_CORRECTION_ACTIVE_PROJECTION_HEADING,
  EPISODIC_CORRECTION_METADATA_PROJECTION_HEADING,
  RUNTIME_STATUS_LOCAL_STORAGE_NOTE,
} from "./messages.js";
import {
  defaultExplicitCorrectionRecordId,
  EXPLICIT_CORRECTION_DEFAULT_RECORD_ID_PREFIX,
} from "./capture-correction-mapper.js";
import { FIXTURE_ISO } from "./runtime-semantics.test-fixture.js";

const CORRECTION_EPISODIC_FRAME = {
  id: "frame-1",
  event_type: "correction" as const,
  summary: "Operator correction note",
  details: {
    target_entity_id: "frame-target",
    correction_of: "frame-target",
    capture_path: "explicit_operator_correction",
  },
  tags: [] as string[],
  scope: "user" as const,
  curation_mode: "personal" as const,
  occurred_at: FIXTURE_ISO,
  recorded_at: FIXTURE_ISO,
  source_signals: [] as string[],
  related_entities: {},
  evidence_refs: [] as string[],
  provenance: {},
  confidence: "high" as const,
  source: "user_explicit" as const,
  sensitivity: "normal" as const,
  visibility: "user_private" as const,
  pinned: false,
  lifecycle_state: "active" as const,
};

describe("explicit correction runtime contract gates", () => {
  it("status note does not regress to correct unwired", () => {
    assert.match(RUNTIME_STATUS_LOCAL_STORAGE_NOTE, /inspect, seed, and correct/);
    assert.doesNotMatch(
      RUNTIME_STATUS_LOCAL_STORAGE_NOTE,
      /correct.*unwired|unwired.*correct|correct not wired/i,
    );
  });

  it("projection formatter emits the canonical active correction heading", () => {
    const formatted = formatEpisodicFrameForRuntime(CORRECTION_EPISODIC_FRAME);
    assert.ok(formatted);
    assert.equal(formatted.lines[0], EPISODIC_CORRECTION_ACTIVE_PROJECTION_HEADING);
  });

  it("projection formatter emits the canonical metadata-only correction heading", () => {
    const formatted = formatEpisodicFrameForRuntime({
      ...CORRECTION_EPISODIC_FRAME,
      sensitivity: "secret_redacted",
    });
    assert.ok(formatted);
    assert.equal(formatted.lines[0], EPISODIC_CORRECTION_METADATA_PROJECTION_HEADING);
  });

  it("default record id follows explicit-correction prefix contract", () => {
    assert.equal(
      defaultExplicitCorrectionRecordId("frame-123"),
      `${EXPLICIT_CORRECTION_DEFAULT_RECORD_ID_PREFIX}frame-123`,
    );
  });

  it("amp shell status lists runtime correct as wired", async () => {
    const program = new Command().name("ai-memory");
    registerAmpCommands(program);
    const amp = program.commands.find((cmd) => cmd.name() === "amp");
    assert.ok(amp);

    const chunks: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;

    try {
      await amp.commands.find((cmd) => cmd.name() === "status")?.parseAsync([], { from: "user" });
    } finally {
      process.stdout.write = originalWrite;
    }

    const output = chunks.join("");
    assert.match(output, /runtime status\/inspect\/seed\/correct/);
    assert.match(output, /typed entity inspect\/seed\/correct on local storage/);
    assert.doesNotMatch(output, /correct.*unwired|unwired.*correct|correct not wired/i);
  });

  it("runtime correct subcommand description does not claim unwired", () => {
    const program = new Command().name("ai-memory");
    registerAmpCommands(program);
    const amp = program.commands.find((cmd) => cmd.name() === "amp");
    assert.ok(amp);

    const runtime = amp.commands.find((cmd) => cmd.name() === "runtime");
    assert.ok(runtime);
    assert.match(runtime.description(), /inspect\/seed\/correct on local typed storage/);

    const correct = runtime.commands.find((cmd) => cmd.name() === "correct");
    assert.ok(correct);
    assert.match(correct.description(), /typed runtime semantic storage/);
    assert.doesNotMatch(
      `${correct.description()} ${runtime.description()}`,
      /correct.*unwired|unwired.*correct|correct not wired/i,
    );
  });
});
