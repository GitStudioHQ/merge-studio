# Changelog

## 0.1.0 — first public release

Renamed to **Merge Studio** (formerly "JetBrains-style Merge & Diff").

- **Conflicts dialog**: auto-opens when any git operation produces conflicts; Accept Yours / Accept Theirs / Merge per file; branch context and live progress; Cancel Merge restores the repository (merge, rebase, cherry-pick, revert); ⚠ status-bar button while conflicts remain.
- **3-way merge editor**: JetBrains-faithful 3-pane layout with curved gutter ribbons, glassy two-intensity highlighting, per-side apply/append/ignore, bulk non-conflicting actions, magic-wand resolution, F7 navigation, whitespace modes.
- **Undo/redo with action history**: ⌘Z / ⇧⌘Z (Ctrl on Windows/Linux), toolbar buttons, and a history dropdown; snapshots cover text, block state, and tracked spans together.
- **Side-by-side diff**: two files or working tree vs HEAD, live re-diff while editing.
- **Real JetBrains IDE integration**: optionally shell out to an installed WebStorm/PyCharm/IntelliJ merge window, auto-detected.
- Embedded editor's Cancel asks: exit the viewer, or cancel the whole merge request.
- Pixel-aligned solid conflict frames across panes and gutters; full-bleed marketplace icon.
