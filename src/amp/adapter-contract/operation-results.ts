/**
 * Typed success/error shapes for adapter contract operations.
 *
 * Falsifiable claim: every data operation returns a discriminated union
 * with `success: true` payload or `success: false` plus an AmpError.
 */

import { z } from "zod";

import type { AmpError } from "../core/errors.js";
import { isAmpError } from "../core/errors.js";

export type OperationError = { error: AmpError };

export type ReadResult<TItem> =
  | { success: true; items: TItem[] }
  | ({ success: false } & OperationError);

export type WriteResult =
  | { success: true; writtenCount: number; ids: string[] }
  | ({ success: false } & OperationError);

export const SearchHitSchema = z
  .object({
    item: z.unknown(),
    score: z.number(),
    rank: z.number().int().nonnegative(),
  })
  .strict();

export type SearchHit<TItem> = {
  item: TItem;
  score: number;
  rank: number;
};

export type SearchResult<TItem> =
  | { success: true; hits: SearchHit<TItem>[] }
  | ({ success: false } & OperationError);

export type MutateResult<TItem> =
  | { success: true; item: TItem }
  | ({ success: false } & OperationError);

export type ListResult<TItem> =
  | { success: true; items: TItem[] }
  | ({ success: false } & OperationError);

export function readSuccess<TItem>(items: TItem[]): ReadResult<TItem> {
  return { success: true, items };
}

export function readFailure<TItem>(error: AmpError): ReadResult<TItem> {
  return { success: false, error };
}

export function writeSuccess(writtenCount: number, ids: string[]): WriteResult {
  return { success: true, writtenCount, ids };
}

export function writeFailure(error: AmpError): WriteResult {
  return { success: false, error };
}

export function searchSuccess<TItem>(hits: SearchHit<TItem>[]): SearchResult<TItem> {
  return { success: true, hits };
}

export function searchFailure<TItem>(error: AmpError): SearchResult<TItem> {
  return { success: false, error };
}

export function mutateSuccess<TItem>(item: TItem): MutateResult<TItem> {
  return { success: true, item };
}

export function mutateFailure<TItem>(error: AmpError): MutateResult<TItem> {
  return { success: false, error };
}

export function listSuccess<TItem>(items: TItem[]): ListResult<TItem> {
  return { success: true, items };
}

export function listFailure<TItem>(error: AmpError): ListResult<TItem> {
  return { success: false, error };
}

export function isReadSuccess<TItem>(
  result: ReadResult<TItem>
): result is { success: true; items: TItem[] } {
  return result.success === true;
}

export function isWriteSuccess(
  result: WriteResult
): result is { success: true; writtenCount: number; ids: string[] } {
  return result.success === true;
}

export function isSearchSuccess<TItem>(
  result: SearchResult<TItem>
): result is { success: true; hits: SearchHit<TItem>[] } {
  return result.success === true;
}

export function isMutateSuccess<TItem>(
  result: MutateResult<TItem>
): result is { success: true; item: TItem } {
  return result.success === true;
}

export function isListSuccess<TItem>(
  result: ListResult<TItem>
): result is { success: true; items: TItem[] } {
  return result.success === true;
}

export function operationError(result: { success: false; error: unknown }): AmpError | undefined {
  if (result.success !== false) return undefined;
  return isAmpError(result.error) ? result.error : undefined;
}
