# Merge Studio — JetBrains-Style Merge & Diff

![Merge Studio — a JetBrains-style merge editor and diff, embedded in VS Code](media/banner.png)

The **JetBrains (IntelliJ / PyCharm / WebStorm) merge-conflict experience, embedded in VS Code and Cursor**: a faithful 3-pane merge editor with curved gutter ribbons, a conflicts dialog that drives your whole merge session, undo/redo with action history, and a side-by-side diff viewer.

[![License: MIT](https://img.shields.io/badge/License-MIT-44a248.svg)](LICENSE)
[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-db61a2?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/antonarnaudov)
[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-%E2%98%95-6b5be6)](https://checkout.revolut.com/pay/7a6070ab-99ba-4170-a125-c5911b1a5c1d)

> 100% free and open source (MIT). If Merge Studio saves your merges, [❤️ sponsor](https://github.com/sponsors/antonarnaudov) or [☕ buy me a coffee](https://checkout.revolut.com/pay/7a6070ab-99ba-4170-a125-c5911b1a5c1d).

![The 3-way merge editor](media/screenshots/merge-editor.png)

## Why

VS Code's built-in 3-way merge editor cannot be themed or replaced through any public API, and nothing on the marketplace reproduces the JetBrains merge workflow. Merge Studio self-renders that experience inside the editor using Monaco — and if you have a real JetBrains IDE installed, it can hand the merge to it instead.

## Features

### Conflicts dialog

The moment a merge, rebase, cherry-pick, or revert produces conflicts, the **Conflicts** page opens — instantly, via direct `.git` operation-state watchers rather than the slower git extension poll:

![The Conflicts dialog](media/screenshots/conflicts-dialog.png)

- Every conflicted file listed with **Accept Yours · Accept Theirs · Merge…** actions
- **Resolved files stay in the list** — green and check-marked, labeled with how they were settled (kept yours / kept theirs / merged)
- **Hold-to-undo** on every resolved file: hold for 1.5s and `git checkout -m` restores the original conflict — even for files resolved in the merge editor
- Branch context (`yours master ⟵ theirs feature`) and a live progress bar
- When everything is resolved: a green confirmation with a Close button — files stay reviewable and undoable until you commit; committing or cancelling closes the dialog automatically
- **Cancel Merge** aborts the operation and restores the repository to its pre-merge state (works for merge, rebase, cherry-pick, and revert)
- A ⚠ **Resolve Conflicts** status-bar button while any conflicts remain

![All conflicts resolved](media/screenshots/conflicts-resolved.png)

### 3-way merge editor

Left (yours) · Result (editable) · Right (theirs), exactly like the IntelliJ merge dialog:

- Two-intensity glassy change highlighting that keeps syntax colors readable
- Curved gutter **ribbons** connecting changes across panes, with crisp conflict frames
- Per-side resolution: apply (≫/≪), append (Ctrl-click), or ignore (✕) each side independently — and the Accept Left/Right button that settles the merge lights up with a green check
- Apply all non-conflicting changes (left / right / all), magic-wand for identical edits
- **Undo/redo with action history** — ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Shift+Z), toolbar buttons, and a history dropdown listing every action by name
- Change navigation (F7 / Shift+F7), synchronized scrolling, whitespace modes, large-file fallback
- Conflicted files route into the merge editor automatically when opened

### Side-by-side diff

![Side-by-side diff](media/screenshots/diff-view.png)

- **Compare** (Explorer right-click, or the `Merge Studio: Compare` command): diff any two selected files, or a single file against its git HEAD
- Live re-diff while you edit the right pane
- Same ribbons, colors, and navigation as the merge editor
- Prefer the real IDE? Set `jbMerge.diffTool: "jetbrains"` to hand the diff to your installed JetBrains IDE instead

### Real JetBrains IDE integration (optional)

If a JetBrains IDE is installed — WebStorm, PyCharm, IntelliJ IDEA, PhpStorm, GoLand, CLion, Rider, RubyMine, or DataGrip — Merge Studio can shell out to the **real** IDE merge window (`jbMerge.conflictResolver: "jetbrains"`), auto-detecting the IDE from PATH or /Applications.

## Install

- **VS Code**: search "Merge Studio" in the Extensions view, or `ext install antonarnaudov.merge-studio`
- **Cursor / VSCodium**: install from the marketplace, or download the `.vsix` from [GitHub releases](https://github.com/antonarnaudov/merge-studio/releases) and use "Install from VSIX…"

**Requirements**: VS Code 1.74+ (or Cursor), git on your PATH, and the built-in Git extension enabled. Merge Studio runs where your repository lives, so it needs a trusted, local (non-virtual) workspace.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `jbMerge.conflictResolver` | `webview` | `webview` = embedded editor, `jetbrains` = launch the real installed IDE |
| `jbMerge.diffTool` | `embedded` | Tool for the **Compare** command: `embedded` editor, or `jetbrains` to open the real IDE (falls back to embedded if none is found) |
| `jbMerge.autoOpen` | `true` | Automatically open conflicted files with the selected resolver |
| `jbMerge.preferredIde` | `auto` | Which JetBrains IDE to launch (`auto` picks the first found) |
| `jbMerge.jetbrainsPath` | `""` | Explicit path to a JetBrains IDE launcher |

## Development

```bash
npm install           # install dependencies
npm run watch         # incremental build (extension + webview)
# Press F5 in VS Code to launch the Extension Development Host

npm test              # pure-logic unit tests
npm run check-types   # TypeScript type-check
npx @vscode/vsce package   # build the .vsix
```

| Layer | Responsibility |
| --- | --- |
| `src/extension.ts` | Activation, commands, auto-open routing, conflicts watcher |
| `src/conflictsPanel.ts` | The Conflicts dialog (webview) |
| `src/mergeEditorProvider.ts` | `CustomTextEditorProvider` hosting the merge webview |
| `src/git/` | git service, merge ops (accept side / abort), abort flow |
| `src/jetbrains/` | Real-IDE detection and shell-out |
| `src/engine/` | Diff/merge model (pure, unit-tested) |
| `webview/` | Front-end: Monaco panes, ribbons, decorations, undo history |

## Support the project

Merge Studio is free, MIT-licensed, and built nights & weekends. If it makes your merges painless, a little support keeps it maintained and funds new features:

- ❤️ **[Sponsor on GitHub](https://github.com/sponsors/antonarnaudov)** — recurring support
- ☕ **[Buy me a coffee](https://checkout.revolut.com/pay/7a6070ab-99ba-4170-a125-c5911b1a5c1d)** — a one-off tip via Revolut

Thank you — it genuinely helps. 🙏

## License

[MIT](LICENSE)
