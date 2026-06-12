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
  private readonly layerA: SVGGElement;
  private readonly layerB: SVGGElement;
  private readonly subs: monaco.IDisposable[] = [];
  private rafHandle = 0;

  constructor(
    gutterA: HTMLElement,
    gutterB: HTMLElement,
    private readonly editors: MergeEditors,
    private readonly getModel: () => MergeModel | undefined,
    private readonly options: RibbonOptions = {},
  ) {
    const a = createSvg();
    const b = createSvg();
    this.svgA = a.svg;
    this.layerA = a.layer;
    this.svgB = b.svg;
    this.layerB = b.layer;
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
    clearChildren(this.layerA);
    clearChildren(this.layerB);
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

      const leftPending =
        !!block.left && !this.options.isSideDone?.(block, "left");
      const rightPending =
        !!block.right && !this.options.isSideDone?.(block, "right");
      // Pane widths for the conflict frame lines, which extend out of the
      // gutter across the neighboring panes (single-renderer continuity).
      // Gutter A covers the left pane (and the result only when gutter B
      // won't draw, to avoid double-compositing the translucent stroke);
      // gutter B covers the result and right panes.
      const leftWidth = this.editors.left.getLayoutInfo().width;
      const resultWidth = this.editors.result.getLayoutInfo().width;
      const rightWidth = this.editors.right.getLayoutInfo().width;

      if (leftPending && block.left) {
        const side = spanY(this.editors.left, block.left.sideSpan, lineHeight);
        const result = spanY(this.editors.result, resultSpan, lineHeight);
        appendRibbon(
          this.layerA,
          widthA,
          heightA,
          side,
          result,
          role,
          { side: "a", width: MERGE_ICON_STRIP },
          { before: leftWidth, after: rightPending ? 0 : resultWidth },
        );
      }
      if (rightPending && block.right) {
        const result = spanY(this.editors.result, resultSpan, lineHeight);
        const side = spanY(this.editors.right, block.right.sideSpan, lineHeight);
        appendRibbon(
          this.layerB,
          widthB,
          heightB,
          result,
          side,
          role,
          { side: "b", width: MERGE_ICON_STRIP },
          { before: resultWidth, after: rightWidth },
        );
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
  private readonly layer: SVGGElement;
  private readonly subs: monaco.IDisposable[] = [];
  private rafHandle = 0;

  constructor(
    gutter: HTMLElement,
    private readonly editors: DiffEditors,
    private readonly getModel: () => DiffModel | undefined,
  ) {
    const surface = createSvg();
    this.svg = surface.svg;
    this.layer = surface.layer;
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
    clearChildren(this.layer);
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
      appendRibbon(this.layer, width, height, left, right, block.role, {
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
/** Corner radius for the frame-line and band bends ("smooth, not technical"). */
const BEND_RADIUS = 7;

function appendRibbon(
  target: SVGElement,
  width: number,
  height: number,
  a: [number, number],
  b: [number, number],
  role: string,
  strip?: IconStrip,
  /** Conflict frame lines extend this far beyond the gutter, over the panes. */
  extend?: { before: number; after: number },
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

  // Band fill: a closed ring of the top run + reversed bottom run, with the
  // interior bends rounded. The corners at x=0 / x=width stay sharp — they
  // must sit flush against the pane line-highlights.
  const ring = [...topPoints, ...bottomPoints.slice().reverse()];
  const d =
    roundedPath(ring, 0, (x) => x > 0.5 && x < width - 0.5) + " Z";

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("class", `jb-ribbon jb-ribbon-${role}`);
  target.appendChild(path);

  if (role === "conflict") {
    // The frame is ONE path per edge, stretched across the neighboring panes
    // (the overlay clips vertically but not horizontally) — a single SVG
    // path cannot mismatch itself the way pane CSS borders and separate
    // gutter strokes used to. +0.5 keeps the 1px stroke crisp on its row.
    const withExtensions = (points: Array<[number, number]>) => {
      const extended = points.slice();
      if (extend?.before) {
        extended.unshift([-extend.before, points[0][1]]);
      }
      if (extend?.after) {
        extended.push([width + extend.after, points[points.length - 1][1]]);
      }
      return extended;
    };
    appendEdge(target, roundedPath(withExtensions(topPoints), 0.5));
    appendEdge(target, roundedPath(withExtensions(bottomPoints), 0.5));
  }
}

/**
 * SVG path through the points (with a uniform y offset), rounding the bend
 * at each interior vertex with a quadratic join. `roundable` can exempt
 * vertices that must stay sharp; first/last points are never rounded.
 */
function roundedPath(
  points: Array<[number, number]>,
  dy: number,
  roundable: (x: number) => boolean = () => true,
): string {
  const pts = points.map(([x, y]) => [x, y + dy] as [number, number]);
  let d = `M ${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i];
    if (!roundable(px)) {
      d += ` L ${fmt(px)} ${fmt(py)}`;
      continue;
    }
    const [ix, iy] = pts[i - 1];
    const [ox, oy] = pts[i + 1];
    const inLen = Math.hypot(px - ix, py - iy);
    const outLen = Math.hypot(ox - px, oy - py);
    const r = Math.min(BEND_RADIUS, inLen / 2, outLen / 2);
    if (r < 0.5 || inLen === 0 || outLen === 0) {
      d += ` L ${fmt(px)} ${fmt(py)}`;
      continue;
    }
    const inX = px - ((px - ix) * r) / inLen;
    const inY = py - ((py - iy) * r) / inLen;
    const outX = px + ((ox - px) * r) / outLen;
    const outY = py + ((oy - py) * r) / outLen;
    d += ` L ${fmt(inX)} ${fmt(inY)} Q ${fmt(px)} ${fmt(py)} ${fmt(outX)} ${fmt(outY)}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  d += ` L ${fmt(lx)} ${fmt(ly)}`;
  return d;
}

/** One solid conflict-boundary line (gutter + extensions over the panes). */
function appendEdge(target: SVGElement, d: string): void {
  const edge = document.createElementNS(SVG_NS, "path");
  edge.setAttribute("d", d);
  edge.setAttribute("class", "jb-ribbon-edge");
  target.appendChild(edge);
}

interface RibbonSurface {
  svg: SVGSVGElement;
  /** All drawing goes here: clipped to the editor rows, free horizontally. */
  layer: SVGGElement;
}

let clipIdCounter = 0;

function createSvg(): RibbonSurface {
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.setAttribute("class", "jb-ribbon-overlay");
  svg.setAttribute("preserveAspectRatio", "none");
  // Vertical-only clip: frame lines extend horizontally across the panes but
  // must never paint over the headers above. CSS clip-path inset() clamps
  // negative (expanding) values, so the clip lives inside the SVG, where a
  // rect can be arbitrarily wide. height="100%" tracks the viewport live.
  const clipId = `jb-ribbon-clip-${++clipIdCounter}`;
  const defs = document.createElementNS(SVG_NS, "defs");
  const clip = document.createElementNS(SVG_NS, "clipPath");
  clip.setAttribute("id", clipId);
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", "-100000");
  rect.setAttribute("y", "0");
  rect.setAttribute("width", "200000");
  rect.setAttribute("height", "100%");
  clip.appendChild(rect);
  defs.appendChild(clip);
  const layer = document.createElementNS(SVG_NS, "g") as SVGGElement;
  layer.setAttribute("clip-path", `url(#${clipId})`);
  svg.append(defs, layer);
  return { svg, layer };
}

function clearChildren(node: Element): void {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function fmt(value: number): string {
  return value.toFixed(1);
}
