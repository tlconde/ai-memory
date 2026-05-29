/**
 * Deterministic procedure checksum for upstream manifest entries.
 */

import { createHash } from "node:crypto";

import type { CanonicalProcedure } from "../procedural/schema.js";

/** Stable SHA-256 checksum over canonical procedure JSON. */
export function procedureChecksum(procedure: CanonicalProcedure): string {
  return createHash("sha256").update(JSON.stringify(procedure)).digest("hex");
}
