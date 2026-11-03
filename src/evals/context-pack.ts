import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { cleanContextTemp, verifyContextPack } from "../cli/context-pack.js";
import type { EvalMetric } from "./types.js";

export async function evalContextPack(aiDir: string): Promise<EvalMetric> {
  const projectRoot = resolve(aiDir, "..");
  const contextDir = join(aiDir, "context");
  if (!existsSync(contextDir)) {
    return {
      name: "Context pack",
      value: "not configured",
      status: "warn",
      note: "Run `ai-memory context init` for a small repo navigation pack",
    };
  }

  const checks = await verifyContextPack(projectRoot);
  const failed = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  const staleTemp = await cleanContextTemp(projectRoot, 7, false);

  const noteParts: string[] = [];
  if (failed.length > 0) noteParts.push(`${failed.length} failing check(s)`);
  if (warnings.length > 0) noteParts.push(`${warnings.length} warning(s)`);
  if (staleTemp.length > 0) noteParts.push(`${staleTemp.length} stale temp file(s)`);

  return {
    name: "Context pack",
    value: `${checks.length - failed.length}/${checks.length} checks passing`,
    status: failed.length > 0 ? "bad" : warnings.length > 0 || staleTemp.length > 0 ? "warn" : "good",
    note: noteParts.length > 0 ? noteParts.join(", ") : undefined,
  };
}
