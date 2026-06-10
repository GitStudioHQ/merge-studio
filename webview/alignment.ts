// Pure computation of spacer view-zones that pad each pane's change blocks so
// corresponding unchanged lines sit at the same vertical position across the
// three panes. No monaco import => unit-testable.

import type {
  ChangeBlock,
  DiffModel,
  LineSpan,
  MergeModel,
} from "../src/engine/types";

export interface Spacer {
  /** Monaco afterLineNumber (0 = top of the editor). */
  afterLineNumber: number;
  /** Number of blank lines' worth of height to insert. */
  lines: number;
}

export interface AlignmentZones {
  left: Spacer[];
  result: Spacer[];
  right: Spacer[];
}

export interface DiffAlignmentZones {
  left: Spacer[];
  right: Spacer[];
}

/**
 * For every block, the aligned height is the tallest of the three panes'
 * versions of that block; shorter panes get a spacer to match, which realigns
 * everything below the block.
 *
 * `resultSpanOf` supplies the block's CURRENT span in the (editable) result
 * document — accepts and manual edits change result block heights, and the
 * spacers must track them or every row below drifts out of alignment. When
 * omitted, the base span is used (the result starts as a copy of base).
 */
export function computeAlignmentZones(
  model: MergeModel,
  resultSpanOf?: (block: ChangeBlock) => LineSpan,
): AlignmentZones {
  const zones: AlignmentZones = { left: [], result: [], right: [] };

  // Running line-number offset of each side relative to base (from prior blocks).
  let leftOffset = 0;
  let rightOffset = 0;

  for (const block of model.blocks) {
    const baseStart = block.baseSpan.start;
    const baseEnd = block.baseSpan.endExclusive;
    const baseHeight = baseEnd - baseStart;

    const resultSpan = resultSpanOf?.(block) ?? block.baseSpan;
    const resultStart = resultSpan.start;
    const resultHeight = resultSpan.endExclusive - resultSpan.start;

    const leftStart = block.left
      ? block.left.sideSpan.start
      : baseStart + leftOffset;
    const leftEnd = block.left
      ? block.left.sideSpan.endExclusive
      : baseEnd + leftOffset;
    const leftHeight = leftEnd - leftStart;

    const rightStart = block.right
      ? block.right.sideSpan.start
      : baseStart + rightOffset;
    const rightEnd = block.right
      ? block.right.sideSpan.endExclusive
      : baseEnd + rightOffset;
    const rightHeight = rightEnd - rightStart;

    const aligned = Math.max(leftHeight, resultHeight, rightHeight);

    addSpacer(zones.left, leftStart, leftHeight, aligned - leftHeight);
    addSpacer(zones.result, resultStart, resultHeight, aligned - resultHeight);
    addSpacer(zones.right, rightStart, rightHeight, aligned - rightHeight);

    // Offsets for sides without a change in a block stay base-relative: the
    // side documents never change, only the result does.
    leftOffset += leftHeight - baseHeight;
    rightOffset += rightHeight - baseHeight;
  }

  return zones;
}

/**
 * 2-pane variant: for every diff block, the shorter of the left/right versions
 * gets a spacer so the unchanged lines below it line up across both panes.
 */
export function computeDiffAlignment(model: DiffModel): DiffAlignmentZones {
  const zones: DiffAlignmentZones = { left: [], right: [] };

  for (const block of model.blocks) {
    const leftHeight = block.leftSpan.endExclusive - block.leftSpan.start;
    const rightHeight = block.rightSpan.endExclusive - block.rightSpan.start;
    const aligned = Math.max(leftHeight, rightHeight);

    addSpacer(zones.left, block.leftSpan.start, leftHeight, aligned - leftHeight);
    addSpacer(
      zones.right,
      block.rightSpan.start,
      rightHeight,
      aligned - rightHeight,
    );
  }

  return zones;
}

function addSpacer(
  target: Spacer[],
  paneStart: number,
  paneHeight: number,
  extraLines: number,
): void {
  if (extraLines <= 0) {
    return;
  }
  // Anchor after the block's last line, or at the insertion gap if empty.
  const afterLineNumber =
    paneHeight > 0 ? paneStart + paneHeight - 1 : paneStart - 1;
  target.push({ afterLineNumber: Math.max(afterLineNumber, 0), lines: extraLines });
}
