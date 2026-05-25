import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Command } from "commander";

import { AMP_CLI_SHELL_VERSION, registerAmpCommands } from "./index.js";

describe("registerAmpCommands", () => {
  it("adds an amp command group to the root program", () => {
    const program = new Command().name("ai-memory");
    registerAmpCommands(program);

    const amp = program.commands.find((cmd) => cmd.name() === "amp");
    assert.ok(amp, "expected amp command group");
    assert.match(amp.description(), /Agent Memory Protocol/);

    const init = amp.commands.find((cmd) => cmd.name() === "init");
    assert.ok(init, "expected amp init subcommand");

    const doctor = amp.commands.find((cmd) => cmd.name() === "doctor");
    assert.ok(doctor, "expected amp doctor subcommand");

    const gbrainPreflight = amp.commands.find((cmd) => cmd.name() === "gbrain-preflight");
    assert.ok(gbrainPreflight, "expected amp gbrain-preflight subcommand");

    const capture = amp.commands.find((cmd) => cmd.name() === "capture");
    assert.ok(capture, "expected amp capture subcommand");

    const consolidate = amp.commands.find((cmd) => cmd.name() === "consolidate");
    assert.ok(consolidate, "expected amp consolidate subcommand");

    const retrieve = amp.commands.find((cmd) => cmd.name() === "retrieve");
    assert.ok(retrieve, "expected amp retrieve subcommand");

    const propagate = amp.commands.find((cmd) => cmd.name() === "propagate");
    assert.ok(propagate, "expected amp propagate subcommand");

    const projection = amp.commands.find((cmd) => cmd.name() === "projection");
    assert.ok(projection, "expected amp projection command group");

    const projectionRender = projection.commands.find((cmd) => cmd.name() === "render");
    assert.ok(projectionRender, "expected amp projection render subcommand");
    assert.ok(
      projectionRender.options.some((option) => option.long?.includes("--source")),
      "expected --source option on projection render"
    );
    assert.ok(
      projectionRender.options.some((option) => option.long?.includes("--apply")),
      "expected --apply option on projection render"
    );

    const agent = amp.commands.find((cmd) => cmd.name() === "agent");
    assert.ok(agent, "expected amp agent command group");

    const agentSetup = agent.commands.find((cmd) => cmd.name() === "setup");
    assert.ok(agentSetup, "expected amp agent setup subcommand");
    assert.ok(
      agentSetup.options.some((option) => option.long?.includes("--target")),
      "expected --target option on agent setup"
    );
    assert.ok(
      agentSetup.options.some((option) => option.long?.includes("--apply")),
      "expected --apply option on agent setup"
    );

    const status = amp.commands.find((cmd) => cmd.name() === "status");
    assert.ok(status, "expected amp status shell subcommand");
  });

  it("status mentions agent setup wiring", async () => {
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
    assert.match(output, /agent setup/);
  });

  it("status mentions local projection source", async () => {
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
    assert.match(output, /--source local/);
    assert.match(output, /--source gbrain/);
    assert.match(output, /AMP_KNOWLEDGE_BACKEND=in-memory/);
  });

  it("exports a stable shell version constant", () => {
    assert.match(AMP_CLI_SHELL_VERSION, /^\d+\.\d+\.\d+$/);
  });
});
