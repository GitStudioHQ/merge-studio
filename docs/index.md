---
title: Merge Studio
---

# Merge Studio

**The merge editor for VS Code and Cursor.** VS Code and Cursor never had a real
merge editor — so I built it. A three-pane view (yours, the result you'll commit,
theirs) joined by color ribbons and one-click accept arrows, a Conflicts
dashboard that tracks every file, full undo history, and a precise side-by-side
diff.

## Install

- **VS Code**: search **Merge Studio** in the Extensions view, or [marketplace.visualstudio.com/items?itemName=gitstudio.merge-studio](https://marketplace.visualstudio.com/items?itemName=gitstudio.merge-studio)
- **Open VSX** (Cursor, VSCodium, Windsurf): [open-vsx.org/extension/gitstudio/merge-studio](https://open-vsx.org/extension/gitstudio/merge-studio)
- **VSIX**: grab the latest from [GitHub Releases](https://github.com/GitStudioHQ/merge-studio/releases) and run *Extensions: Install from VSIX…*

## What it does

- **3-way merge editor** — yours on the left, the result in the middle, theirs on
  the right, with accept / ignore ribbons per change and a per-action undo history.
- **Conflicts dashboard** — every conflicted file in one list, with Accept Yours /
  Accept Theirs / Merge and a hold-to-undo.
- **Side-by-side diff** — working tree vs HEAD, with intra-line highlights.
- **Open in a JetBrains IDE** — optionally resolve a conflict or diff in an
  installed IntelliJ, WebStorm, PyCharm, or other JetBrains IDE.

## Links

- [Source & issues on GitHub](https://github.com/GitStudioHQ/merge-studio)
- [Changelog](https://github.com/GitStudioHQ/merge-studio/blob/main/CHANGELOG.md)
