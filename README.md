# Merge Studio — JetBrains-Style Merge & Diff

The **JetBrains (IntelliJ / PyCharm / WebStorm) merge-conflict experience, embedded in VS Code and Cursor**: a faithful 3-pane merge editor with curved gutter ribbons, a conflicts dialog that drives your whole merge session, undo/redo with action history, and a side-by-side diff viewer.

> 100% free and open source (MIT). If Merge Studio saves your merges, consider [sponsoring the project](https://github.com/sponsors/antonarnaudov) ❤️

## Why

VS Code's built-in 3-way merge editor cannot be themed or replaced through any public API, and nothing on the marketplace reproduces the JetBrains merge workflow. Merge Studio self-renders that experience inside the editor using Monaco — and if you have a real JetBrains IDE installed, it can hand the merge to it instead.

## Features

### Conflicts dialog

The moment a merge, rebase, cherry-pick, or revert produces conflicts, the **Conflicts** page opens by itself — just like in IntelliJ:

- Every conflicted file listed with **Accept Yours · Accept Theirs · Merge…** actions
- Branch context (`yours master ⟵ theirs feature`) and a live progress bar
- Stays with you until every conflict is resolved, then closes itself
- **Cancel Merge** aborts the operation and restores the repository to its pre-merge state (works for merge, rebase, cherry-pick, and revert)
- A ⚠ **Resolve Conflicts** status-bar button while any conflicts remain

### 3-way merge editor

Left (yours) · Result (editable) · Right (theirs), exactly like the IntelliJ merge dialog:

- Two-intensity glassy change highlighting that keeps syntax colors readable
- Curved gutter **ribbons** connecting changes across panes, with crisp conflict frames
- Per-side resolution: apply (≫/≪), append (Ctrl-click), or ignore (✕) each side independently
- Apply all non-conflicting changes (left / right / all), magic-wand for identical edits
- **Undo/redo with action history** — ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Shift+Z), toolbar buttons, and a history dropdown listing every action by name
- Change navigation (F7 / Shift+F7), synchronized scrolling, whitespace modes, large-file fallback
- Conflicted files route into the merge editor automatically when opened

### Side-by-side diff

- Explorer: compare any two files, or a file against its git HEAD
- Live re-diff while you edit the right pane
- Same ribbons, colors, and navigation as the merge editor

### Real JetBrains IDE integration (optional)

If WebStorm, PyCharm, IntelliJ, or another JetBrains IDE is installed, Merge Studio can shell out to the **real** IDE merge window (`jbMerge.conflictResolver: "jetbrains"`), auto-detecting the IDE from PATH or /Applications.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `jbMerge.conflictResolver` | `webview` | `webview` = embedded editor, `jetbrains` = launch the real installed IDE |
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

## Sponsor

Merge Studio is free, MIT-licensed, and built nights-and-weekends. If it makes your merges painless, [a sponsorship or tip](https://github.com/sponsors/antonarnaudov) keeps it maintained and motivates new features.

## License

[MIT](LICENSE)
