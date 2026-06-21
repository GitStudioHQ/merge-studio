<h1 align="center">Merge Studio</h1>

<p align="center">
  <b>The JetBrains-style three-pane merge &amp; diff experience, embedded in VS Code and Cursor.</b>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=gitstudio.merge-studio"><img src="https://img.shields.io/visual-studio-marketplace/v/gitstudio.merge-studio?label=VS%20Marketplace&logo=visualstudiocode&logoColor=white&color=6B5BE6" alt="VS Marketplace version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=gitstudio.merge-studio"><img src="https://img.shields.io/visual-studio-marketplace/i/gitstudio.merge-studio?label=installs&color=6B5BE6" alt="VS Marketplace installs"></a>
  <a href="https://open-vsx.org/extension/gitstudio/merge-studio"><img src="https://img.shields.io/open-vsx/v/gitstudio/merge-studio?label=Open%20VSX&logo=eclipseide&logoColor=white&color=C160EF" alt="Open VSX version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-44a248.svg" alt="License: MIT"></a>
  <a href="https://github.com/sponsors/antonarnaudov"><img src="https://img.shields.io/badge/Sponsor-%E2%9D%A4-db61a2?logo=githubsponsors&logoColor=white" alt="Sponsor"></a>
</p>

<p align="center">
  <img src="media/banner.png" alt="Merge Studio — a JetBrains-style merge editor and diff, embedded in VS Code">
</p>

Merge Studio brings the **IntelliJ / WebStorm / PyCharm merge-conflict workflow** to VS Code and Cursor: a faithful three-pane merge editor with curved gutter ribbons, a conflicts dashboard that drives the whole session, full undo history, and a precise side-by-side diff. Nothing external required — and if you already run a JetBrains IDE, Merge Studio can hand the merge straight to it.

---

## Three-pane merge editor

<p align="center"><img src="media/screenshots/merge-editor.png" alt="The three-pane merge editor — yours, result, theirs"></p>

Left is **yours**, the center is the **result** you commit, right is **theirs** — joined by color ribbons and accept arrows, just like the JetBrains merge dialog. Edit the result freely; alignment re-flows live as you type.

- Per-side resolution — apply (≫ / ≪), append (Ctrl-click), or ignore (✕) each change independently
- Apply all non-conflicting changes (left / right / all), plus a magic-wand for identical edits
- **Undo / redo with a named action history** — ⌘Z / ⇧⌘Z, toolbar buttons, and a history dropdown
- Curved ribbons connect changes across panes, with crisp frames around true conflicts
- Two-intensity highlighting that keeps syntax colors readable
- Change navigation (F7 / ⇧F7), synchronized scrolling, whitespace modes, large-file fallback

## Conflicts dashboard

<p align="center"><img src="media/screenshots/conflicts-dialog.png" alt="The conflicts dashboard listing every conflicted file"></p>

The moment a merge, rebase, cherry-pick, or revert produces conflicts, the **Conflicts** page opens automatically — driven by direct `.git` operation-state watchers, not the slower git-extension poll.

- Every conflicted file with **Accept Yours · Accept Theirs · Merge…** actions
- Resolved files stay in the list — green, check-marked, and labeled with how they were settled
- **Hold-to-undo** on any resolved file: hold 1.5s and `git checkout -m` restores the original conflict
- **Cancel Merge** aborts the operation and restores the pre-merge state (merge, rebase, cherry-pick, revert)
- Live progress bar, branch context (`yours ⟵ theirs`), and a ⚠ status-bar button while conflicts remain

<p align="center"><img src="media/screenshots/conflicts-resolved.png" alt="The conflicts dashboard with every file resolved"></p>

## Side-by-side diff

<p align="center"><img src="media/screenshots/diff-view.png" alt="Line-aligned side-by-side diff with intra-line highlights"></p>

- **Compare** any two files, or a single file against its git `HEAD` — Explorer right-click or the `Merge Studio: Compare` command
- Live re-diff as you edit the right pane, with intra-line highlights on exactly what changed
- The same ribbons, colors, and navigation as the merge editor

## Optional: hand off to a real JetBrains IDE

Have WebStorm, PyCharm, IntelliJ IDEA, PhpStorm, GoLand, CLion, Rider, RubyMine, or DataGrip installed? Set `jbMerge.conflictResolver: "jetbrains"` (or `jbMerge.diffTool: "jetbrains"`) and Merge Studio shells out to the **real** IDE window, auto-detecting it from your PATH or `/Applications`. Entirely optional — everything above works without it.

## Install

**VS Code** — search **Merge Studio** in the Extensions view, or:

```bash
code --install-extension gitstudio.merge-studio
```

**Cursor / VSCodium / Windsurf / Gitpod** — via the [Open VSX Registry](https://open-vsx.org/extension/gitstudio/merge-studio):

```bash
cursor --install-extension gitstudio.merge-studio
```

**Sideload a `.vsix`** — download the latest from [GitHub Releases](https://github.com/antonarnaudov/merge-studio/releases/latest):

```bash
code --install-extension merge-studio-0.3.0.vsix
```

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `jbMerge.conflictResolver` | `webview` | `webview` = embedded editor, `jetbrains` = launch the real installed IDE |
| `jbMerge.diffTool` | `embedded` | Tool for the **Compare** command: `embedded`, or `jetbrains` (falls back to embedded if no IDE is found) |
| `jbMerge.autoOpen` | `true` | Automatically open conflicted files with the selected resolver |
| `jbMerge.preferredIde` | `auto` | Which JetBrains IDE to launch (`auto` picks the first one found) |
| `jbMerge.jetbrainsPath` | `""` | Explicit path to a JetBrains IDE launcher (overrides auto-detection) |

## Requirements

VS Code **1.74+** (or Cursor), **git** on your `PATH`, and the built-in Git extension enabled. Merge Studio operates on a repository on disk, so it needs a trusted, non-virtual (local) workspace.

## Development

```bash
npm install              # install dependencies
npm run watch            # incremental build (extension + webview)
npm test                 # pure-logic unit tests
npm run check-types      # TypeScript type-check
npx @vscode/vsce package # build the .vsix
```

Press **F5** in VS Code to launch the Extension Development Host.

| Layer | Responsibility |
| --- | --- |
| `src/extension.ts` | Activation, commands, auto-open routing, conflicts watcher |
| `src/conflictsPanel.ts` | The Conflicts dashboard (webview) |
| `src/mergeEditorProvider.ts` | `CustomTextEditorProvider` hosting the merge webview |
| `src/git/` | git service, merge ops (accept side / abort), abort flow |
| `src/jetbrains/` | Real-IDE detection and shell-out |
| `src/engine/` | Diff / merge model (pure, unit-tested) |
| `webview/` | Front-end: Monaco panes, ribbons, decorations, undo history |

## Support

Merge Studio is free, MIT-licensed, and built nights & weekends. If it makes your merges painless:

- ❤️ **[Sponsor on GitHub](https://github.com/sponsors/antonarnaudov)** — recurring support
- ☕ **[Buy me a coffee](https://checkout.revolut.com/pay/7a6070ab-99ba-4170-a125-c5911b1a5c1d)** — a one-off tip

## License

[MIT](LICENSE) — part of the **GitStudio** family.

---

<sub>JetBrains, IntelliJ IDEA, WebStorm, PyCharm, PhpStorm, GoLand, CLion, Rider, RubyMine, and DataGrip are trademarks of JetBrains s.r.o. Merge Studio is an independent project and is not affiliated with, or endorsed by, JetBrains.</sub>
