# Changelog

## 0.1.8

- Resolution buttons deactivate when they have nothing left to do: Accept Left / Accept Right disable once every change is processed, and the Apply-non-conflicting toolbar actions disable when no non-conflicting changes remain. They re-enable on undo or reset.

## 0.1.7

- Conflict frame edges are now one single path spanning every covered column (left pane, gutter A, result, gutter B, right pane). Previously the line was split per gutter, leaving the bend at the gutter-A/result junction on a path endpoint — which cannot be rounded — so the left side showed sharp corners while the right side was smooth. All bends are interior vertices now, all rounded, verified in the browser harness at retina scale.

## 0.1.6

- Fixed the ribbon stage rendering at its intrinsic 300×150px size: SVG is a replaced element, so `left/right` insets alone don't stretch it — everything beyond ~300px (gutter bands, frame lines over the result and right panes) was silently clipped. The stage now gets explicit width/height. Verified end-to-end in a real-browser harness (`test-harness/`): continuous frame lines across all five columns, band fills, scrolled states, and retina rendering, with path geometry checked numerically.

## 0.1.5

- Bands and conflict frame lines now draw on a single full-width SVG stage spanning all five columns (panes + gutters), in absolute coordinates. The previous per-gutter overlays needed their strokes to escape the gutter box, which browser clipping kept eating — on the stage nothing leaves the viewport, so the frame lines finally render across the editors and their line numbers too.

## 0.1.4

- Restored the frame lines across the editor panes: CSS `clip-path: inset()` clamps negative (expanding) values, so the previous release accidentally clipped the extended lines at the gutter edge. The vertical-only clip now lives inside the SVG, where the clip rect can be arbitrarily wide.
- Rounded the bends of the frame lines and band corners (quadratic joins, 7px radius) for a smoother look; flush corners against the pane highlights stay sharp.
- Gutter buttons trimmed to 16px tall with a 2px radius — clear of the frame lines above and below.

## 0.1.3

- Conflict frame lines are now each a single continuous SVG polyline spanning panes and gutters (drawn by the gutter overlays, extended across the neighboring panes). Previously the pane segments were CSS borders and the gutter segments SVG strokes — two renderers that could land a pixel apart at fractional scroll offsets or display scalings. One path cannot mismatch itself.

## 0.1.2

- Gutter action buttons no longer overflow the band frame: 18px tall (fits a code line) with the wider 20px hit area kept, clamped below the band's top border.
- Disabled scroll animation in all panes — smooth scrolling let the panes and gutter overlays animate through transiently different offsets, visibly detaching bands and frame lines mid-scroll.
- Faster re-alignment after result edits (120ms debounce).

## 0.1.1

- Gutter accept/ignore icons now live inside a straight, rectangular segment of the change band that hugs the side pane (the slant to the result pane starts after it, as in IntelliJ) and are anchored to that pane's rows — they no longer drift out of the color while scrolling.
- Bigger gutter action buttons (20px, 15px icons) and wider merge gutters to fit the icon strip.
- The 2-way diff's transfer arrow gets the same strip treatment.
- Accept-button hover color fixed for light themes.

## 0.1.0 — first public release

Renamed to **Merge Studio** (formerly "JetBrains-style Merge & Diff").

- **Conflicts dialog**: auto-opens when any git operation produces conflicts; Accept Yours / Accept Theirs / Merge per file; branch context and live progress; Cancel Merge restores the repository (merge, rebase, cherry-pick, revert); ⚠ status-bar button while conflicts remain.
- **3-way merge editor**: JetBrains-faithful 3-pane layout with curved gutter ribbons, glassy two-intensity highlighting, per-side apply/append/ignore, bulk non-conflicting actions, magic-wand resolution, F7 navigation, whitespace modes.
- **Undo/redo with action history**: ⌘Z / ⇧⌘Z (Ctrl on Windows/Linux), toolbar buttons, and a history dropdown; snapshots cover text, block state, and tracked spans together.
- **Side-by-side diff**: two files or working tree vs HEAD, live re-diff while editing.
- **Real JetBrains IDE integration**: optionally shell out to an installed WebStorm/PyCharm/IntelliJ merge window, auto-detected.
- Embedded editor's Cancel asks: exit the viewer, or cancel the whole merge request.
- Pixel-aligned solid conflict frames across panes and gutters; full-bleed marketplace icon.
