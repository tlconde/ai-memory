/**
 * Adapter role declaration (surface | substrate | both).
 *
 * Falsifiable claim: every adapter declares exactly one role value that
 * determines whether surface, substrate, or dual spec discovery applies.
 */

import { z } from "zod";

export const AdapterRoleSchema = z.enum(["surface", "substrate", "both"]);
export type AdapterRole = z.infer<typeof AdapterRoleSchema>;

export const RoleDeclarationSchema = z
  .object({
    role: AdapterRoleSchema,
  })
  .strict();

export type RoleDeclaration = z.infer<typeof RoleDeclarationSchema>;

export type RoleDeclarationParseResult =
  | { success: true; declaration: RoleDeclaration }
  | { success: false; error: string };

export function parseRoleDeclaration(input: unknown): RoleDeclarationParseResult {
  const parsed = RoleDeclarationSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }
  return { success: true, declaration: parsed.data };
}

/** Returns true when the adapter participates in surface (SAS) operations. */
export function roleIncludesSurface(role: AdapterRole): boolean {
  return role === "surface" || role === "both";
}

/** Returns true when the adapter participates in substrate (SSA) operations. */
export function roleIncludesSubstrate(role: AdapterRole): boolean {
  return role === "substrate" || role === "both";
}
