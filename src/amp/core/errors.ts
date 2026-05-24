/**
 * AMP JSON-RPC 2.0 error envelope and protocol-specific codes.
 *
 * Falsifiable claim: every AMP error maps to a JSON-RPC 2.0 error object with
 * a stable code, message, and optional data payload.
 */

export const JSONRPC_VERSION = "2.0";

/** AMP-specific error codes (spec §12.1). */
export const AmpErrorCode = {
  SUBSTRATE_OFFLINE: -32001,
  FRAME_SCHEMA_MISMATCH: -32002,
  SURFACE_INJECT_FAILURE: -32003,
  TRANSPORT_TIMEOUT: -32004,
  CONCURRENT_WRITE_CONFLICT: -32005,
  PARTIAL_FEDERATION_FAILURE: -32006,
  TRANSACTION_ROLLBACK: -32007,
  CAPABILITY_NOT_SUPPORTED: -32008,
  RUNTIME_QUEUE_FULL: -32009,
  PROPAGATION_TARGET_UNREACHABLE: -32010,
} as const;

export type AmpErrorCodeValue = (typeof AmpErrorCode)[keyof typeof AmpErrorCode];

export interface JsonRpcErrorObject {
  code: AmpErrorCodeValue | number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: typeof JSONRPC_VERSION;
  id: string | number | null;
  error: JsonRpcErrorObject;
}

export interface AmpErrorOptions {
  code: AmpErrorCodeValue | number;
  message: string;
  data?: unknown;
  retriable?: boolean;
}

export class AmpError extends Error {
  readonly code: AmpErrorCodeValue | number;
  readonly data?: unknown;
  readonly retriable: boolean;

  constructor(options: AmpErrorOptions) {
    super(options.message);
    this.name = "AmpError";
    this.code = options.code;
    this.data = options.data;
    this.retriable = options.retriable ?? defaultRetriable(options.code);
  }

  toJsonRpc(id: string | number | null = null): JsonRpcErrorResponse {
    return {
      jsonrpc: JSONRPC_VERSION,
      id,
      error: {
        code: this.code,
        message: this.message,
        ...(this.data !== undefined ? { data: this.data } : {}),
      },
    };
  }
}

/** Default retriable flag per spec §12.1 when not explicitly set. */
export function defaultRetriable(code: AmpErrorCodeValue | number): boolean {
  switch (code) {
    case AmpErrorCode.SUBSTRATE_OFFLINE:
    case AmpErrorCode.SURFACE_INJECT_FAILURE:
    case AmpErrorCode.TRANSPORT_TIMEOUT:
    case AmpErrorCode.CONCURRENT_WRITE_CONFLICT:
    case AmpErrorCode.RUNTIME_QUEUE_FULL:
    case AmpErrorCode.PROPAGATION_TARGET_UNREACHABLE:
      return true;
    case AmpErrorCode.PARTIAL_FEDERATION_FAILURE:
      return false;
    case AmpErrorCode.TRANSACTION_ROLLBACK:
      return false;
    default:
      return false;
  }
}

export function frameSchemaMismatch(details?: unknown): AmpError {
  return new AmpError({
    code: AmpErrorCode.FRAME_SCHEMA_MISMATCH,
    message: "Frame failed schema validation",
    data: details,
    retriable: false,
  });
}

export function capabilityNotSupported(feature: string): AmpError {
  return new AmpError({
    code: AmpErrorCode.CAPABILITY_NOT_SUPPORTED,
    message: `Capability not supported by backend: ${feature}`,
    data: { feature },
    retriable: false,
  });
}

export function projectScopeRequiresRef(context?: string): AmpError {
  return new AmpError({
    code: AmpErrorCode.FRAME_SCHEMA_MISMATCH,
    message: "project scope requires projectRef",
    data: context ? { context } : undefined,
    retriable: false,
  });
}

export function isAmpError(value: unknown): value is AmpError {
  return value instanceof AmpError;
}

export function isJsonRpcErrorResponse(value: unknown): value is JsonRpcErrorResponse {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    obj.jsonrpc === JSONRPC_VERSION &&
    obj.error !== undefined &&
    typeof obj.error === "object" &&
    obj.error !== null &&
    typeof (obj.error as Record<string, unknown>).code === "number" &&
    typeof (obj.error as Record<string, unknown>).message === "string"
  );
}
