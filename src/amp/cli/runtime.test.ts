import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Command } from "commander";

import { RUNTIME_ENTITY_SCHEMA_NAMES } from "../runtime-semantics/schema.js";
import { registerAmpCommands } from "./index.js";
import {
  formatAmpRuntimeCorrectReport,
  formatAmpRuntimeInspectJson,
  formatAmpRuntimeInspectReport,
  formatAmpRuntimeStatusReport,
  runAmpRuntimeCorrect,
  runAmpRuntimeInspect,
  runAmpRuntimeStatus,
  RUNTIME_CORRECT_NOT_WIRED,
  RUNTIME_INSPECT_NOT_WIRED,
  RUNTIME_STORAGE_NOT_WIRED,
} from "./runtime.js";

describe("runAmpRuntimeStatus", () => {
  it("lists supported entity schemas and storage not-wired note", () => {
    const result = runAmpRuntimeStatus();
    assert.equal(result.ok, true);
    assert.equal(result.storageWired, false);
    assert.deepEqual(result.schemas, RUNTIME_ENTITY_SCHEMA_NAMES);

    const text = formatAmpRuntimeStatusReport(result).join("\n");
    assert.match(text, /UnresolvedDecision/);
    assert.match(text, /RuntimePreferenceCandidate/);
    assert.match(text, /RuntimeCrystalCandidate/);
    assert.match(text, /HarnessOperationalState/);
    assert.match(text, /RejectedSignalLog/);
    assert.match(text, /EpisodicFrame/);
    assert.match(text, /DormantSnapshot/);
    assert.match(text, new RegExp(RUNTIME_STORAGE_NOT_WIRED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});

describe("runAmpRuntimeInspect", () => {
  it("succeeds as read-only stub for episodic-frame", () => {
    const result = runAmpRuntimeInspect({
      projectRoot: "/tmp/demo",
      entity: "episodic-frame",
    });

    assert.equal(result.ok, true);
    assert.equal(result.entity, "episodic-frame");
    assert.equal(result.entitySchemaName, "EpisodicFrame");
    assert.equal(result.storageWired, false);

    const text = formatAmpRuntimeInspectReport(result).join("\n");
    assert.match(text, /episodic-frame \(EpisodicFrame\)/);
    assert.match(text, new RegExp(RUNTIME_INSPECT_NOT_WIRED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(text, /no state was mutated/);
  });

  it("rejects invalid entity kind with clear error", () => {
    const result = runAmpRuntimeInspect({ entity: "not-a-real-kind" });

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /Invalid runtime entity kind "not-a-real-kind"/);
    assert.match(result.error ?? "", /episodic-frame/);

    const text = formatAmpRuntimeInspectReport(result).join("\n");
    assert.match(text, /ERROR Runtime inspect did not run/);
  });

  it("returns parseable JSON with --json formatting helper", () => {
    const result = runAmpRuntimeInspect({
      projectRoot: "/tmp/demo",
      entity: "dormant-snapshot",
    });
    const payload = JSON.parse(formatAmpRuntimeInspectJson(result)) as {
      ok: boolean;
      entity: string;
      entitySchemaName: string;
      storageWired: boolean;
      message: string;
    };

    assert.equal(payload.ok, true);
    assert.equal(payload.entity, "dormant-snapshot");
    assert.equal(payload.entitySchemaName, "DormantSnapshot");
    assert.equal(payload.storageWired, false);
    assert.equal(payload.message, RUNTIME_INSPECT_NOT_WIRED);
  });
});

describe("runAmpRuntimeCorrect", () => {
  it("refuses to mutate and explains future wiring", () => {
    const result = runAmpRuntimeCorrect({
      projectRoot: "/tmp/demo",
      id: "frame-123",
      note: "Reclassify as correction_event",
    });

    assert.equal(result.ok, false);
    assert.equal(result.storageWired, false);
    assert.equal(result.error, RUNTIME_CORRECT_NOT_WIRED);

    const text = formatAmpRuntimeCorrectReport(result).join("\n");
    assert.match(text, /frame-123/);
    assert.match(text, /Reclassify as correction_event/);
    assert.match(text, /not available yet/);
    assert.match(text, /no state was mutated/);
  });
});

describe("registerAmpCommands runtime group", () => {
  it("registers runtime status, inspect, and correct subcommands", () => {
    const program = new Command().name("ai-memory");
    registerAmpCommands(program);

    const amp = program.commands.find((cmd) => cmd.name() === "amp");
    assert.ok(amp);

    const runtime = amp.commands.find((cmd) => cmd.name() === "runtime");
    assert.ok(runtime, "expected amp runtime command group");

    const status = runtime.commands.find((cmd) => cmd.name() === "status");
    assert.ok(status, "expected amp runtime status subcommand");

    const inspect = runtime.commands.find((cmd) => cmd.name() === "inspect");
    assert.ok(inspect, "expected amp runtime inspect subcommand");
    assert.ok(
      inspect.options.some((option) => option.long?.includes("--entity")),
      "expected --entity option on runtime inspect"
    );
    assert.ok(
      inspect.options.some((option) => option.long?.includes("--json")),
      "expected --json option on runtime inspect"
    );

    const correct = runtime.commands.find((cmd) => cmd.name() === "correct");
    assert.ok(correct, "expected amp runtime correct subcommand");
    assert.ok(
      correct.options.some((option) => option.long?.includes("--id")),
      "expected --id option on runtime correct"
    );
    assert.ok(
      correct.options.some((option) => option.long?.includes("--note")),
      "expected --note option on runtime correct"
    );
  });

  it("amp status mentions runtime command group", async () => {
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
    assert.match(output, /runtime status\/inspect\/correct/);
    assert.match(output, /storage not wired/);
  });
});
