import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeAlignmentZones,
  computeDiffAlignment,
} from "../webview/alignment";
import { buildMergeModel } from "../src/engine/mergeModel";
import { buildDiffModel } from "../src/engine/diffModel";

const lines = (arr: string[]): string => arr.join("\n");

test("pads result and right when left replaces 1 line with 3", () => {
  const model = buildMergeModel(
    lines(["a", "b", "c"]),
    lines(["a", "X", "Y", "Z", "c"]),
    lines(["a", "b", "c"]),
  );
  const zones = computeAlignmentZones(model);
  assert.deepEqual(zones.left, []);
  assert.deepEqual(zones.result, [{ afterLineNumber: 2, lines: 2 }]);
  assert.deepEqual(zones.right, [{ afterLineNumber: 2, lines: 2 }]);
});

test("no spacers when all blocks are single-line replacements", () => {
  const model = buildMergeModel(
    lines(["a", "b", "c"]),
    lines(["a", "B1", "c"]),
    lines(["a", "b", "C1"]),
  );
  const zones = computeAlignmentZones(model);
  assert.deepEqual(zones.left, []);
  assert.deepEqual(zones.result, []);
  assert.deepEqual(zones.right, []);
});

test("insertion on one side adds a spacer at the gap on the other panes", () => {
  const model = buildMergeModel(
    lines(["a", "b"]),
    lines(["a", "NEW", "b"]),
    lines(["a", "b"]),
  );
  const zones = computeAlignmentZones(model);
  assert.deepEqual(zones.left, []);
  assert.deepEqual(zones.result, [{ afterLineNumber: 1, lines: 1 }]);
  assert.deepEqual(zones.right, [{ afterLineNumber: 1, lines: 1 }]);
});

test("re-balances spacers from the CURRENT result span after an accept", () => {
  // Left replaces 1 line with 3; the user accepts left, so the result block
  // grows from 1 line (base) to 3 lines and no longer needs a spacer.
  const model = buildMergeModel(
    lines(["a", "b", "c"]),
    lines(["a", "X", "Y", "Z", "c"]),
    lines(["a", "b", "c"]),
  );
  const zones = computeAlignmentZones(model, () => ({
    start: 2,
    endExclusive: 5, // accepted left text now occupies result lines 2-4
  }));
  assert.deepEqual(zones.left, []);
  assert.deepEqual(zones.result, []);
  assert.deepEqual(zones.right, [{ afterLineNumber: 2, lines: 2 }]);
});

test("re-balances spacers when an accepted deletion empties the result span", () => {
  // Left deleted line "b"; accepting left collapses the result span to empty,
  // so result needs the same gap spacer the left pane gets.
  const model = buildMergeModel(
    lines(["a", "b", "c"]),
    lines(["a", "c"]),
    lines(["a", "b", "c"]),
  );
  const zones = computeAlignmentZones(model, () => ({
    start: 2,
    endExclusive: 2,
  }));
  assert.deepEqual(zones.left, [{ afterLineNumber: 1, lines: 1 }]);
  assert.deepEqual(zones.result, [{ afterLineNumber: 1, lines: 1 }]);
  assert.deepEqual(zones.right, []);
});

test("diff: a right-side insertion pads the left pane at the gap", () => {
  const model = buildDiffModel(lines(["a", "b"]), lines(["a", "NEW", "b"]));
  const zones = computeDiffAlignment(model);
  assert.deepEqual(zones.right, []);
  assert.deepEqual(zones.left, [{ afterLineNumber: 1, lines: 1 }]);
});

test("diff: a right-side deletion pads the right pane at the gap", () => {
  const model = buildDiffModel(lines(["a", "b", "c"]), lines(["a", "c"]));
  const zones = computeDiffAlignment(model);
  assert.deepEqual(zones.left, []);
  assert.deepEqual(zones.right, [{ afterLineNumber: 1, lines: 1 }]);
});

test("diff: single-line modification needs no spacers", () => {
  const model = buildDiffModel(lines(["a", "b", "c"]), lines(["a", "B", "c"]));
  const zones = computeDiffAlignment(model);
  assert.deepEqual(zones.left, []);
  assert.deepEqual(zones.right, []);
});
