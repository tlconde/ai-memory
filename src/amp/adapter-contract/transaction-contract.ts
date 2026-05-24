/**
 * Transaction contract shape for multi-primitive adapter writes.
 *
 * Falsifiable claim: adapters that declare transaction support expose
 * begin/commit/rollback with typed handles and commit/rollback results.
 *
 * Interface only — no implementation in adapter-contract.
 */

import { z } from "zod";

import type { AmpError } from "../core/errors.js";
import type { OperationError } from "./operation-results.js";

export const TransactionHandleSchema = z
  .object({
    id: z.string().min(1),
    startedAt: z.string().datetime(),
  })
  .strict();

export type TransactionHandle = z.infer<typeof TransactionHandleSchema>;

export type TransactionBeginResult =
  | { success: true; handle: TransactionHandle }
  | ({ success: false } & OperationError);

export type TransactionCommitResult =
  | { success: true; committedAt: string }
  | ({ success: false; rolledBack: boolean } & OperationError);

export type TransactionRollbackResult =
  | { success: true }
  | ({ success: false } & OperationError);

export type TransactionBeginFn = () => TransactionBeginResult | Promise<TransactionBeginResult>;

export type TransactionCommitFn = (
  handle: TransactionHandle
) => TransactionCommitResult | Promise<TransactionCommitResult>;

export type TransactionRollbackFn = (
  handle: TransactionHandle
) => TransactionRollbackResult | Promise<TransactionRollbackResult>;

/** Contract surface for transaction primitives (spec §6.3, §10.2). */
export interface AdapterTransactionContract {
  transactionBegin: TransactionBeginFn;
  transactionCommit: TransactionCommitFn;
  transactionRollback: TransactionRollbackFn;
}

export function transactionBeginSuccess(handle: TransactionHandle): TransactionBeginResult {
  return { success: true, handle };
}

export function transactionBeginFailure(error: AmpError): TransactionBeginResult {
  return { success: false, error };
}

export function transactionCommitSuccess(committedAt: string): TransactionCommitResult {
  return { success: true, committedAt };
}

export function transactionCommitFailure(
  error: AmpError,
  rolledBack: boolean
): TransactionCommitResult {
  return { success: false, rolledBack, error };
}

export function transactionRollbackSuccess(): TransactionRollbackResult {
  return { success: true };
}

export function transactionRollbackFailure(error: AmpError): TransactionRollbackResult {
  return { success: false, error };
}

export type TransactionHandleParseResult =
  | { success: true; handle: TransactionHandle }
  | { success: false; error: string };

export function parseTransactionHandle(input: unknown): TransactionHandleParseResult {
  const parsed = TransactionHandleSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }
  return { success: true, handle: parsed.data };
}
