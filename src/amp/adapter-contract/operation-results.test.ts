import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { capabilityNotSupported } from "../core/errors.js";
import {
  isListSuccess,
  isMutateSuccess,
  isReadSuccess,
  isSearchSuccess,
  isWriteSuccess,
  listFailure,
  listSuccess,
  mutateFailure,
  mutateSuccess,
  operationError,
  readFailure,
  readSuccess,
  searchFailure,
  searchSuccess,
  writeFailure,
  writeSuccess,
} from "./operation-results.js";

describe("operation result success shapes", () => {
  it("readSuccess returns items", () => {
    const result = readSuccess([{ id: "a" }]);
    assert.equal(isReadSuccess(result), true);
    assert.deepEqual(result.items, [{ id: "a" }]);
  });

  it("writeSuccess returns writtenCount and ids", () => {
    const result = writeSuccess(2, ["a", "b"]);
    assert.equal(isWriteSuccess(result), true);
    assert.equal(result.writtenCount, 2);
    assert.deepEqual(result.ids, ["a", "b"]);
  });

  it("searchSuccess returns ranked hits", () => {
    const result = searchSuccess([{ item: { id: "x" }, score: 0.9, rank: 0 }]);
    assert.equal(isSearchSuccess(result), true);
    assert.equal(result.hits[0]?.score, 0.9);
  });

  it("mutateSuccess returns item", () => {
    const result = mutateSuccess({ id: "m1", value: 1 });
    assert.equal(isMutateSuccess(result), true);
    assert.equal(result.item.id, "m1");
  });

  it("listSuccess returns items", () => {
    const result = listSuccess(["one", "two"]);
    assert.equal(isListSuccess(result), true);
    assert.deepEqual(result.items, ["one", "two"]);
  });
});

describe("operation result failure shapes", () => {
  it("readFailure carries AmpError", () => {
    const err = capabilityNotSupported("vector_search");
    const result = readFailure(err);
    assert.equal(result.success, false);
    assert.equal(operationError(result)?.code, err.code);
  });

  it("writeFailure carries AmpError", () => {
    const err = capabilityNotSupported("transactions");
    const result = writeFailure(err);
    assert.equal(isWriteSuccess(result), false);
    assert.equal(operationError(result)?.message, err.message);
  });

  it("searchFailure carries AmpError", () => {
    const result = searchFailure(capabilityNotSupported("full_text_search"));
    assert.equal(result.success, false);
    assert.match(operationError(result)?.message ?? "", /not supported/i);
  });

  it("mutateFailure carries AmpError", () => {
    const result = mutateFailure(capabilityNotSupported("graph_traversal"));
    assert.equal(result.success, false);
  });

  it("listFailure carries AmpError", () => {
    const result = listFailure(capabilityNotSupported("profile_slots"));
    assert.equal(result.success, false);
  });
});
