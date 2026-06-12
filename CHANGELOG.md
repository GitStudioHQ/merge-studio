# Changelog

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
