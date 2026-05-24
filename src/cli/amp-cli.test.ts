import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = join(__dirname, "index.ts");

function runCli(args: string[]): string {
  return execFileSync(process.execPath, ["--import", "tsx", CLI_ENTRY, ...args], {
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
}

describe("ai-memory amp CLI shell", () => {
  it("registers amp --help without breaking root --version", () => {
    const ampHelp = runCli(["amp", "--help"]);
    assert.match(ampHelp, /Agent Memory Protocol/);
    assert.match(ampHelp, /status/);

    const version = runCli(["--version"]);
    assert.match(version, /\d+\.\d+\.\d+/);
  });

  it("runs amp status shell subcommand", () => {
    const out = runCli(["amp", "status"]);
    assert.match(out, /AMP CLI shell v/);
    assert.match(out, /not wired/i);
  });
});
