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

    const status = amp.commands.find((cmd) => cmd.name() === "status");
    assert.ok(status, "expected amp status shell subcommand");
  });

  it("exports a stable shell version constant", () => {
    assert.match(AMP_CLI_SHELL_VERSION, /^\d+\.\d+\.\d+$/);
  });
});
