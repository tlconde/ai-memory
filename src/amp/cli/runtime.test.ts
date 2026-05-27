import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Command } from "commander";

import { RUNTIME_ENTITY_SCHEMA_NAMES } from "../runtime-semantics/schema.js";
import { RUNTIME_STATUS_LOCAL_STORAGE_NOTE } from "../runtime-semantics/messages.js";
import { registerAmpCommands } from "./index.js";
import {
  formatAmpRuntimeStatusReport,
  runAmpRuntimeCorrect,
  runAmpRuntimeStatus,
} from "./runtime.js";

describe("runAmpRuntimeStatus", () => {
  it("lists supported entity schemas and local storage status note", () => {
    const result = runAmpRuntimeStatus();
    assert.equal(result.ok, true);
    assert.equal(result.localStorageWired, true);
    assert.deepEqual(result.schemas, RUNTIME_ENTITY_SCHEMA_NAMES);

    const text = formatAmpRuntimeStatusReport(result).join("\n");
    assert.match(text, /UnresolvedDecision/);
    assert.match(text, /RuntimePreferenceCandidate/);
    assert.match(text, /RuntimeCrystalCandidate/);
    assert.match(text, /HarnessOperationalState/);
    assert.match(text, /RejectedSignalLog/);
    assert.match(text, /EpisodicFrame/);
    assert.match(text, /DormantSnapshot/);
    assert.match(text, new RegExp(RUNTIME_STATUS_LOCAL_STORAGE_NOTE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});

describe("runAmpRuntimeCorrect", () => {
  it("returns bootstrap error when project AMP config is missing", () => {
    const result = runAmpRuntimeCorrect({
      projectRoot: "/tmp/missing-amp-config",
      id: "frame-123",
      note: "Reclassify as correction_event",
    });

    assert.equal(result.ok, false);
    assert.equal(result.storageWired, false);
    assert.match(result.error ?? "", /Project AMP config not found/);
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

    const seed = runtime.commands.find((cmd) => cmd.name() === "seed");
    assert.ok(seed, "expected amp runtime seed subcommand");
    assert.ok(
      seed.options.some((option) => option.long?.includes("--file")),
      "expected --file option on runtime seed"
    );

    const graduation = runtime.commands.find((cmd) => cmd.name() === "graduation");
    assert.ok(graduation, "expected amp runtime graduation command group");

    const plan = graduation.commands.find((cmd) => cmd.name() === "plan");
    assert.ok(plan, "expected amp runtime graduation plan subcommand");
    assert.ok(
      plan.options.some((option) => option.long?.includes("--entity")),
      "expected --entity option on runtime graduation plan"
    );
  });

  it("mentions read-only graduation plan in amp status wiring", async () => {
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
    assert.match(output, /graduation plan/i);
    assert.match(output, /read-only graduation review/i);
  });
});
