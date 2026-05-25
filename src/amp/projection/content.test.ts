import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyProjectionContentModel,
  estimateProjectionTextTokens,
  renderProjectionContentModel,
  renderProjectionContentSection,
  sortProjectionTextBlocks,
  sumSectionTokenEstimate,
  type ProjectionTextBlock,
} from "./content.js";

describe("ProjectionContentModel", () => {
  it("default model renders non-empty sections", () => {
    const model = createEmptyProjectionContentModel("demo-app");
    const bodies = renderProjectionContentModel(model);

    for (const body of Object.values(bodies)) {
      assert.match(body, /\S/);
      assert.match(body, /^# /m);
    }

    assert.match(bodies.projectProjection, /_Project: demo-app_/);
    assert.match(bodies.projectRuntime, /_Project: demo-app_/);
    assert.match(bodies.globalProjection, /_No content yet\._/);
  });

  it("orders blocks by priority then id", () => {
    const blocks: ProjectionTextBlock[] = [
      {
        id: "block-b",
        label: "Second",
        priority: 1,
        tokenEstimate: 2,
        text: "B",
      },
      {
        id: "block-a",
        label: "First",
        priority: 1,
        tokenEstimate: 2,
        text: "A",
      },
      {
        id: "block-z",
        label: "Later priority",
        priority: 5,
        tokenEstimate: 2,
        text: "Z",
      },
    ];

    const rendered = renderProjectionContentSection("globalProjection", { blocks });
    const firstIndex = rendered.indexOf("## First");
    const secondIndex = rendered.indexOf("## Second");
    const laterIndex = rendered.indexOf("## Later priority");

    assert.ok(firstIndex >= 0);
    assert.ok(secondIndex > firstIndex);
    assert.ok(laterIndex > secondIndex);
    assert.deepEqual(
      sortProjectionTextBlocks(blocks).map((block) => block.id),
      ["block-a", "block-b", "block-z"]
    );
  });

  it("represents project_ref in project sections", () => {
    const model = createEmptyProjectionContentModel("my-project");
    const bodies = renderProjectionContentModel(model);

    assert.match(bodies.projectProjection, /_Project: my-project_/);
    assert.match(bodies.projectRuntime, /_Project: my-project_/);
    assert.doesNotMatch(bodies.globalProjection, /my-project/);
  });

  it("computes tokenEstimate sums per section", () => {
    const model = createEmptyProjectionContentModel("sum-test");
    model.globalProjection.blocks.push({
      id: "g1",
      label: "Global",
      priority: 0,
      tokenEstimate: estimateProjectionTextTokens("alpha"),
      text: "alpha",
    });
    model.projectRuntime.blocks.push(
      {
        id: "p1",
        label: "Runtime A",
        priority: 0,
        tokenEstimate: 10,
        text: "runtime-a",
      },
      {
        id: "p2",
        label: "Runtime B",
        priority: 1,
        tokenEstimate: 5,
        text: "runtime-b",
      }
    );

    assert.equal(sumSectionTokenEstimate(model.globalProjection), estimateProjectionTextTokens("alpha"));
    assert.equal(sumSectionTokenEstimate(model.projectRuntime), 15);
    assert.equal(sumSectionTokenEstimate(model.globalRuntime), 0);
  });
});
