/**
 * Shared runtime CLI entity kind filter parsing.
 *
 * Falsifiable claim: inspect and graduation plan reject unknown --entity values
 * with identical operator-facing errors before storage bootstrap/read.
 */

import {
  RUNTIME_ENTITY_REGISTRY,
  type RuntimeEntityKind,
  type RuntimeEntitySchemaName,
  isRuntimeEntityKind,
  runtimeEntitySchemaNameForKind,
} from "../runtime-semantics/schema.js";

export type RuntimeCliEntityFilterResult =
  | {
      ok: true;
      entity?: RuntimeEntityKind;
      entitySchemaName?: RuntimeEntitySchemaName;
    }
  | {
      ok: false;
      error: string;
    };

/** Parse optional runtime CLI --entity filter; fail closed on unknown kinds. */
export function parseRuntimeCliEntityFilter(
  rawEntity: string | undefined,
): RuntimeCliEntityFilterResult {
  if (rawEntity === undefined) {
    return { ok: true };
  }

  if (!isRuntimeEntityKind(rawEntity)) {
    const expected = RUNTIME_ENTITY_REGISTRY.map((entry) => entry.kind).join(", ");
    return {
      ok: false,
      error: `Invalid runtime entity kind "${rawEntity}" — expected one of: ${expected}.`,
    };
  }

  return {
    ok: true,
    entity: rawEntity,
    entitySchemaName: runtimeEntitySchemaNameForKind(rawEntity),
  };
}
