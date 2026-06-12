import * as monaco from "monaco-editor";
import type {
  ChangeBlock,
  DiffModel,
  LineSpan,
  MergeModel,
  Side,
} from "../src/engine/types";
import { blockRole, isEmptySpan } from "../src/engine/types";
import type { DiffEditors, MergeEditors } from "./decorations";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Width of the straight, rectangular segment of a merge-gutter band that hugs
 * the side pane. The accept/ignore icons live inside this segment, and the
 * slanted connection to the result pane only starts after it — IntelliJ's
 * layout, and what keeps the icons inside the color at every scroll offset.
 * Must fit the action row built in mergeView.makeActions (2 buttons + gaps).
 */
export const MERGE_ICON_STRIP = 46;

/** Same idea for the 2-way diff's single transfer button (left-anchored). */
export const DIFF_ICON_STRIP = 24;

/** Which edge of the gutter carries the rectangular icon segment. */
type StripSide = "a" | "b";

interface IconStrip {
  side: StripSide;
  width: number;
}

export interface RibbonOptions {
  /** Current result-pane span for a block (defaults to its base span). */
  resultSpanOf?: (block: ChangeBlock) => LineSpan;
  /** Fully resolved blocks are not drawn. */
  isResolved?: (block: ChangeBlock) => boolean;
  /** Already-processed sides of a partially resolved block are not drawn. */
  isSideDone?: (block: ChangeBlock, side: Side) => boolean;
}

/**
 * Draws the JetBrains-style connecting bands in the two gutter columns:
 * gutter A links each left-side change to its result region, gutter B links
 * the result region to each right-side change. Flat trapezoids — flush with
 * the line highlights so each change reads as one continuous stripe — whose
 * corners track the editors' line positions on every scroll/layout change.
 */
export class RibbonOverlay {
  private readonly svgA: SVGSVGElement;
  private readonly svgB: SVGSVGElement;
  private readonly subs: monaco.IDisposable[] = [];
  private rafHandle = 0;

  constructor(
    gutterA: HTMLElement,
    gutterB: HTMLElement,
    private readonly editors: MergeEditors,
    private readonly getModel: () => MergeModel | undefined,
    private readonly options: RibbonOptions = {},
  ) {
    this.svgA = createSvg();
    this.svgB = createSvg();
    gutterA.appendChild(this.svgA);
    gutterB.appendChild(this.svgB);

    for (const editor of [editors.left, editors.result, editors.right]) {
      this.subs.push(editor.onDidScrollChange(() => this.scheduleDraw()));
      this.subs.push(editor.onDidLayoutChange(() => this.scheduleDraw()));
    }
    this.scheduleDraw();
  }

  public scheduleDraw(): void {
    if (this.rafHandle) {
      return;
    }
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = 0;
      this.draw();
    });
  }

  private draw(): void {
    clearChildren(this.svgA);
    clearChildren(this.svgB);
    const model = this.getModel();
    if (!model) {
      return;
    }
    const lineHeight = this.editors.left.getOption(
      monaco.editor.EditorOption.lineHeight,
    );
    const widthA = this.svgA.clientWidth;
    const heightA = this.svgA.clientHeight;
    const widthB = this.svgB.clientWidth;
    const heightB = this.svgB.clientHeight;

    for (const block of model.blocks) {
      if (this.options.isResolved?.(block)) {
        continue;
      }
      const role = blockRole(block);
      const resultSpan = this.options.resultSpanOf?.(block) ?? block.baseSpan;

      if (block.left && !this.options.isSideDone?.(block, "left")) {
        const side = spanY(this.editors.left, block.left.sideSpan, lineHeight);
        const result = spanY(this.editors.result, resultSpan, lineHeight);
        appendRibbon(this.svgA, widthA, heightA, side, result, role, {
          side: "a",
          width: MERGE_ICON_STRIP,
        });
      }
      if (block.right && !this.options.isSideDone?.(block, "right")) {
        const result = spanY(this.editors.result, resultSpan, lineHeight);
        const side = spanY(this.editors.right, block.right.sideSpan, lineHeight);
        appendRibbon(this.svgB, widthB, heightB, result, side, role, {
          side: "b",
          width: MERGE_ICON_STRIP,
        });
      }
    }
  }

  public dispose(): void {
    if (this.rafHandle) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }
    for (const sub of this.subs) {
      sub.dispose();
    }
    this.subs.length = 0;
    this.svgA.remove();
    this.svgB.remove();
  }
}

/**
 * Single-gutter ribbon overlay for the 2-way diff: each block's left span is
 * linked to its right span across the one gutter column between the panes.
 */
export class DiffRibbonOverlay {
  private readonly svg: SVGSVGElement;
  private readonly subs: monaco.IDisposable[] = [];
  private rafHandle = 0;

  constructor(
    gutter: HTMLElement,
    private readonly editors: DiffEditors,
    private readonly getModel: () => DiffModel | undefined,
  ) {
    this.svg = createSvg();
    gutter.appendChild(this.svg);

    for (const editor of [editors.left, editors.right]) {
      this.subs.push(editor.onDidScrollChange(() => this.scheduleDraw()));
      this.subs.push(editor.onDidLayoutChange(() => this.scheduleDraw()));
    }
    this.scheduleDraw();
  }

  public scheduleDraw(): void {
    if (this.rafHandle) {
      return;
    }
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = 0;
      this.draw();
    });
  }

  private draw(): void {
    clearChildren(this.svg);
    const model = this.getModel();
    if (!model) {
      return;
    }
    const lineHeight = this.editors.left.getOption(
      monaco.editor.EditorOption.lineHeight,
    );
    const width = this.svg.clientWidth;
    const height = this.svg.clientHeight;

    for (const block of model.blocks) {
      const left = spanY(this.editors.left, block.leftSpan, lineHeight);
      const right = spanY(this.editors.right, block.rightSpan, lineHeight);
      appendRibbon(this.svg, width, height, left, right, block.role, {
        side: "a",
        width: DIFF_ICON_STRIP,
      });
    }
  }

  public dispose(): void {
    if (this.rafHandle) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }
    for (const sub of this.subs) {
      sub.dispose();
    }
    this.subs.length = 0;
    this.svg.remove();
  }
}

/** Returns [topY, bottomY] of a span in the editor's viewport coordinates. */
function spanY(
  editor: monaco.editor.IStandaloneCodeEditor,
  span: LineSpan,
  lineHeight: number,
): [number, number] {
  const scrollTop = editor.getScrollTop();
  const top = editor.getTopForLineNumber(span.start) - scrollTop;
  if (isEmptySpan(span)) {
    return [top, top];
  }
  const bottom =
    editor.getTopForLineNumber(span.endExclusive - 1) + lineHeight - scrollTop;
  return [top, bottom];
}

/**
 * Draws one flat connector band into `svg`, the way IntelliJ's merge tool
 * does. `a` is the x=0 edge (left pane of the gutter), `b` is the x=width
 * edge. When an icon strip is given, the band stays RECTANGULAR (tracking
 * that side's rows exactly) across the strip — the gutter action icons live
 * there, glued to the color — and only slants toward the other pane in the
 * remaining width. Conflict bands additionally get IntelliJ's solid
 * top/bottom boundary lines, following the same polyline.
 */
function appendRibbon(
  svg: SVGSVGElement,
  width: number,
  height: number,
  a: [number, number],
  b: [number, number],
  role: string,
  strip?: IconStrip,
): void {
  const [aTop, aBottom] = a;
  const [bTop, bBottom] = b;
  if ((aBottom < 0 && bBottom < 0) || (aTop > height && bTop > height)) {
    return; // fully outside the viewport
  }

  // x-coordinates of the strip boundary; degrade to a plain trapezoid when
  // the gutter is too narrow for a meaningful slant region.
  const stripWidth = strip ? Math.min(strip.width, width - 8) : 0;
  const topPoints: Array<[number, number]> = [];
  const bottomPoints: Array<[number, number]> = [];
  if (strip && stripWidth > 0 && strip.side === "a") {
    topPoints.push([0, aTop], [stripWidth, aTop], [width, bTop]);
    bottomPoints.push([0, aBottom], [stripWidth, aBottom], [width, bBottom]);
  } else if (strip && stripWidth > 0 && strip.side === "b") {
    topPoints.push([0, aTop], [width - stripWidth, bTop], [width, bTop]);
    bottomPoints.push(
      [0, aBottom],
      [width - stripWidth, bBottom],
      [width, bBottom],
    );
  } else {
    topPoints.push([0, aTop], [width, bTop]);
    bottomPoints.push([0, aBottom], [width, bBottom]);
  }

  const d = [
    ...topPoints.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${fmt(x)} ${fmt(y)}`),
    ...bottomPoints
      .slice()
      .reverse()
      .map(([x, y]) => `L ${fmt(x)} ${fmt(y)}`),
    "Z",
  ].join(" ");

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("class", `jb-ribbon jb-ribbon-${role}`);
  svg.appendChild(path);

  if (role === "conflict") {
    // +0.5 centers the 1px stroke inside the same pixel row as the panes'
    // CSS borders. The decoration divs are content-box, so border-top paints
    // at [y, y+1) and border-bottom one pixel BELOW the line box at
    // [y, y+1) of the boundary — both edges land on the boundary's own row.
    appendEdge(svg, polyline(topPoints, 0.5));
    appendEdge(svg, polyline(bottomPoints, 0.5));
  }
}

/** SVG path string through the points, with a uniform y offset. */
function polyline(points: Array<[number, number]>, dy: number): string {
  return points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${fmt(x)} ${fmt(y + dy)}`)
    .join(" ");
}

/** One solid conflict-boundary line across the gutter strip. */
function appendEdge(svg: SVGSVGElement, d: string): void {
  const edge = document.createElementNS(SVG_NS, "path");
  edge.setAttribute("d", d);
  edge.setAttribute("class", "jb-ribbon-edge");
  svg.appendChild(edge);
}

function createSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "jb-ribbon-overlay");
  svg.setAttribute("preserveAspectRatio", "none");
  return svg;
}

function clearChildren(node: Element): void {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function fmt(value: number): string {
  return value.toFixed(1);
}
