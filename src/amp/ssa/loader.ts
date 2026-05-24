/**
 * SSA spec YAML loader.
 *
 * Falsifiable claim: loading a valid SSA YAML file returns a parsed spec with
 * capability_coverage validated through parseCapabilityCoverage.
 */

import { readFileSync } from "node:fs";

import yaml from "js-yaml";

import { frameSchemaMismatch } from "../core/errors.js";
import { parseSsaSpec, type SsaSpec, type SsaSpecParseResult } from "./schema.js";

export function loadSsaSpecFromYaml(content: string): SsaSpecParseResult {
  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { success: false, error: `Invalid YAML: ${message}` };
  }

  if (parsed === null || parsed === undefined) {
    return { success: false, error: "SSA spec YAML is empty" };
  }

  return parseSsaSpec(parsed);
}

/** Load and validate an SSA spec from a filesystem path. */
export function loadSsaSpecFromFile(filePath: string): SsaSpec {
  const content = readFileSync(filePath, "utf8");
  const result = loadSsaSpecFromYaml(content);
  if (!result.success) {
    throw frameSchemaMismatch({ path: filePath, error: result.error, issues: result.issues });
  }
  return result.spec;
}

/** Load SSA spec without throwing; for callers that prefer result objects. */
export function tryLoadSsaSpecFromFile(filePath: string): SsaSpecParseResult {
  try {
    const content = readFileSync(filePath, "utf8");
    return loadSsaSpecFromYaml(content);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { success: false, error: message };
  }
}
