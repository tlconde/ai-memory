import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { scanImportSources } from "../cli/memory-import.js";
import type { EvalMetric } from "./types.js";

export async function evalMemoryImport(aiDir: string): Promise<EvalMetric> {
  const projectRoot = resolve(aiDir, "..");
  const configPath = join(aiDir, "import-sources.json");
  if (!existsSync(configPath)) {
    return {
      name: "Memory import",
      value: "not configured",
      status: "warn",
      note: "Run `ai-memory import init` to configure cross-agent memory imports",
    };
  }

  const scan = await scanImportSources(projectRoot, ["all"]);
  const enabled = scan.filter((result) => result.status !== "disabled");
  const present = scan.filter((result) => result.status === "present");
  const configure = scan.filter((result) => result.status === "configure");

  return {
    name: "Memory import",
    value: `${present.length}/${enabled.length} enabled source(s) present`,
    status: present.length > 0 ? "good" : configure.length > 0 ? "warn" : "bad",
    note:
      configure.length > 0
        ? `${configure.length} source path(s) need configuration`
        : present.length === 0
          ? "No enabled import source paths exist yet"
          : undefined,
  };
}
