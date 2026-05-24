import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AmpErrorCode, capabilityNotSupported } from "../core/errors.js";
import {
  parseTransactionHandle,
  transactionBeginFailure,
  transactionBeginSuccess,
  transactionCommitFailure,
  transactionCommitSuccess,
  transactionRollbackFailure,
  transactionRollbackSuccess,
  type AdapterTransactionContract,
} from "./transaction-contract.js";

describe("parseTransactionHandle", () => {
  it("accepts a valid handle", () => {
    const result = parseTransactionHandle({
      id: "tx-1",
      startedAt: "2026-05-25T12:00:00.000Z",
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.handle.id, "tx-1");
    }
  });

  it("rejects empty id", () => {
    const result = parseTransactionHandle({
      id: "",
      startedAt: "2026-05-25T12:00:00.000Z",
    });
    assert.equal(result.success, false);
  });

  it("rejects invalid datetime", () => {
    const result = parseTransactionHandle({
      id: "tx-1",
      startedAt: "not-a-date",
    });
    assert.equal(result.success, false);
  });
});

describe("transaction result helpers", () => {
  it("transactionBeginSuccess returns handle", () => {
    const handle = { id: "tx-2", startedAt: "2026-05-25T12:00:00.000Z" };
    const result = transactionBeginSuccess(handle);
    assert.equal(result.success, true);
    if (result.success) {
      assert.deepEqual(result.handle, handle);
    }
  });

  it("transactionBeginFailure carries error", () => {
    const err = capabilityNotSupported("transactions");
    const result = transactionBeginFailure(err);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.code, AmpErrorCode.CAPABILITY_NOT_SUPPORTED);
    }
  });

  it("transactionCommitSuccess returns committedAt", () => {
    const result = transactionCommitSuccess("2026-05-25T12:01:00.000Z");
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.committedAt, "2026-05-25T12:01:00.000Z");
    }
  });

  it("transactionCommitFailure records rolledBack flag", () => {
    const err = capabilityNotSupported("transactions");
    const result = transactionCommitFailure(err, true);
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.rolledBack, true);
    }
  });

  it("transactionRollbackSuccess and failure shapes", () => {
    assert.equal(transactionRollbackSuccess().success, true);
    const failed = transactionRollbackFailure(capabilityNotSupported("transactions"));
    assert.equal(failed.success, false);
  });
});

describe("AdapterTransactionContract shape", () => {
  it("accepts sync transaction method signatures", () => {
    const contract: AdapterTransactionContract = {
      transactionBegin: () =>
        transactionBeginSuccess({
          id: "tx-sync",
          startedAt: "2026-05-25T12:00:00.000Z",
        }),
      transactionCommit: () => transactionCommitSuccess("2026-05-25T12:01:00.000Z"),
      transactionRollback: () => transactionRollbackSuccess(),
    };

    const begin = contract.transactionBegin();
    assert.equal(begin.success, true);
  });
});
