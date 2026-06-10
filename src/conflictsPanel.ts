// JetBrains-style "Conflicts" dialog: lists every conflicted file in the
// repository with Accept Yours / Accept Theirs / Merge actions, stays in sync
// with git state until all conflicts are resolved, and can cancel the whole
// merge request (restoring the repository to its pre-merge state).
import * as vscode from "vscode";
import * as path from "path";
import type { Repository } from "./git/git";
import {
  acceptSide,
  describeIncoming,
  detectOperation,
} from "./git/mergeOps";
import {
  closeMergeEditorTabs,
  confirmAndAbortMergeRequest,
} from "./git/abortFlow";
import { findConfiguredLauncher } from "./jetbrains/launcher";

/** One conflicted file as shown in the dialog. */
interface ConflictRow {
  uri: string;
  /** Path relative to the repository root, for display. */
  rel: string;
  /** Special conflict kind ("deleted by them", …); "" for both-modified. */
  badge: string;
}

// vscode.git Status values for special conflict kinds. The Status enum lives
// in a .d.ts, so its members cannot be imported at runtime.
const STATUS_BADGE: Record<number, string> = {
  12: "added by us",
  13: "added by them",
  14: "deleted by us",
  15: "deleted by them",
  16: "added by both",
  17: "deleted by both",
};

type PanelMessage =
  | { type: "accept"; side: "ours" | "theirs"; uri: string }
  | { type: "merge"; uri: string }
  | { type: "abort" };

export class ConflictsPanel {
  private static current: ConflictsPanel | undefined;

  /** Opens (or reveals) the conflicts dialog for the repository. */
  public static show(repo: Repository): void {
    if (
      ConflictsPanel.current &&
      ConflictsPanel.current.root === repo.rootUri.fsPath
    ) {
      ConflictsPanel.current.panel.reveal();
      return;
    }
    ConflictsPanel.current?.panel.dispose();
    ConflictsPanel.current = new ConflictsPanel(repo);
  }

  /**
   * Makes sure the dialog exists for this repository, without stealing focus
   * when it is already open. The conflict watcher calls this on every git
   * state change, so a closed dialog returns as long as conflicts remain —
   * "stays open until every conflict is resolved".
   */
  public static ensureVisible(repo: Repository): void {
    if (
      ConflictsPanel.current &&
      ConflictsPanel.current.root === repo.rootUri.fsPath
    ) {
      return; // already tracking this repo; don't yank focus on refreshes
    }
    ConflictsPanel.show(repo);
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly root: string;
  private readonly subs: vscode.Disposable[] = [];
  private hadConflicts = false;
  /** Every conflict uri seen this session — progress shows X of N even when
   *  new conflicts join mid-session (stash pop, rebase continue). */
  private readonly seenConflicts = new Set<string>();
  private lastCount: number | undefined;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Uri currently being accepted (its row shows a spinner). */
  private busyUri: string | undefined;
  /** Guards refresh() calls that resolve after the panel was disposed. */
  private disposed = false;

  private constructor(private readonly repo: Repository) {
    this.root = repo.rootUri.fsPath;
    this.panel = vscode.window.createWebviewPanel(
      "jbMerge.conflicts",
      "Conflicts",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = renderConflictsHtml();
    this.subs.push(
      this.panel.webview.onDidReceiveMessage((raw: unknown) =>
        void this.onMessage(raw as PanelMessage),
      ),
    );
    this.subs.push(repo.state.onDidChange(() => void this.refresh()));
    this.panel.onDidDispose(() => {
      this.disposed = true;
      if (this.closeTimer) {
        clearTimeout(this.closeTimer);
      }
      this.subs.forEach((sub) => sub.dispose());
      if (ConflictsPanel.current === this) {
        ConflictsPanel.current = undefined;
      }
    });
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const rows: ConflictRow[] = this.repo.state.mergeChanges
      .map((change) => ({
        uri: change.uri.toString(),
        // Forward slashes even on Windows: display-only, and the webview
        // splits dir/name on "/".
        rel: path
          .relative(this.root, change.uri.fsPath)
          .split(path.sep)
          .join("/"),
        badge: STATUS_BADGE[change.status] ?? "",
      }))
      .sort((a, b) => a.rel.localeCompare(b.rel));

    if (rows.length > 0) {
      this.hadConflicts = true;
      if (this.closeTimer) {
        clearTimeout(this.closeTimer);
        this.closeTimer = undefined;
      }
    }

    // Session progress: cumulative, so conflicts that join mid-session
    // (stash pop, rebase continue) don't erase completed work.
    for (const row of rows) {
      this.seenConflicts.add(row.uri);
    }
    const total = this.seenConflicts.size;
    const resolved = Math.max(0, total - rows.length);

    // detectOperation directly (not describeOperation, which masks "nothing
    // in progress" as merge): rows empty + no operation means the merge was
    // aborted elsewhere — closing without celebrating a success that wasn't.
    const liveOperation = await detectOperation(this.root);
    if (this.disposed) {
      return; // disposed while awaiting git
    }
    if (rows.length === 0 && this.hadConflicts && !liveOperation) {
      this.panel.dispose();
      return;
    }

    // A conflict just got resolved: bring the dialog back to the front (the
    // JetBrains flow — finishing a file returns you to the conflicts list).
    if (this.lastCount !== undefined && rows.length < this.lastCount) {
      this.panel.reveal();
    }
    this.lastCount = rows.length;

    this.panel.title =
      rows.length > 0 ? `Conflicts (${rows.length})` : "Conflicts";

    const operation = liveOperation ?? "merge";
    const incoming =
      operation === "merge" ? await describeIncoming(this.root) : undefined;
    if (this.disposed) {
      return;
    }
    void this.panel.webview.postMessage({
      type: "state",
      operation,
      yoursName: this.repo.state.HEAD?.name ?? null,
      theirsName: incoming ?? null,
      files: rows,
      busyUri: this.busyUri ?? null,
      total,
      resolved,
    });

    // All conflicts resolved: let the success state show briefly, then close.
    if (rows.length === 0 && this.hadConflicts && !this.closeTimer) {
      this.closeTimer = setTimeout(() => this.panel.dispose(), 2500);
    }
  }

  private async onMessage(message: PanelMessage): Promise<void> {
    switch (message.type) {
      case "accept":
        await this.accept(message.uri, message.side);
        break;
      case "merge":
        this.mergeFile(message.uri);
        break;
      case "abort":
        await this.abort();
        break;
      default:
        break;
    }
  }

  private async accept(
    uriString: string,
    side: "ours" | "theirs",
  ): Promise<void> {
    if (this.busyUri) {
      return;
    }
    this.busyUri = uriString;
    void this.refresh();
    const uri = vscode.Uri.parse(uriString);
    try {
      await acceptSide(this.root, uri.fsPath, side);
      // A merge editor open on this file would now show a stale conflict.
      await closeMergeEditorTabs(uri);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        `Merge Studio: couldn't resolve ${path.basename(uri.fsPath)} — ${reason}`,
      );
    } finally {
      this.busyUri = undefined;
      void this.refresh();
    }
  }

  /** "Merge…": open the configured resolver, mirroring the auto-open routing. */
  private mergeFile(uriString: string): void {
    const uri = vscode.Uri.parse(uriString);
    const config = vscode.workspace.getConfiguration("jbMerge");
    const resolver = config.get<string>("conflictResolver", "webview");
    if (resolver === "jetbrains" && findConfiguredLauncher()) {
      void vscode.commands.executeCommand("jbMerge.mergeWithJetBrains", uri);
    } else {
      void vscode.commands.executeCommand("jbMerge.resolveInMergeEditor", uri);
    }
  }

  private async abort(): Promise<void> {
    const uris = this.repo.state.mergeChanges.map((change) => change.uri);
    const aborted = await confirmAndAbortMergeRequest(this.root, uris);
    if (aborted) {
      this.panel.dispose();
    }
  }
}

function renderConflictsHtml(): string {
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Conflicts</title>
  <style>
    [hidden] { display: none !important; }
    html, body { height: 100%; margin: 0; padding: 0; }
    body {
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      display: flex;
      justify-content: center;
      --jb-accent: var(--vscode-gitDecoration-conflictingResourceForeground, #d9604c);
      --jb-ok: var(--vscode-testing-iconPassed, var(--vscode-charts-green, #56a05e));
    }
    .dialog {
      width: min(760px, 100%);
      display: flex;
      flex-direction: column;
      height: 100%;
      box-sizing: border-box;
      padding: 26px 28px 16px;
    }

    header { display: flex; align-items: center; gap: 12px; }
    .mark { width: 30px; height: 30px; flex: none; }
    h1 { font-size: 16px; font-weight: 600; margin: 0; letter-spacing: 0.2px; }
    .chip {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      padding: 2px 8px;
      border-radius: 9px;
      color: var(--jb-accent);
      border: 1px solid var(--jb-accent);
      opacity: 0.9;
    }
    .sub {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      margin: 6px 0 0 42px;
    }

    .branches {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 14px 0 0 42px;
      font-size: 12px;
    }
    .branch {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 10px;
      border-radius: 10px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
    }
    .branch .who { opacity: 0.75; font-family: var(--vscode-font-family); }
    .arrow { color: var(--vscode-descriptionForeground); }

    .progress-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 16px 0 10px;
    }
    .bar {
      flex: 1;
      height: 5px;
      border-radius: 3px;
      background: var(--vscode-widget-border, var(--vscode-panel-border));
      overflow: hidden;
    }
    .bar > div {
      height: 100%;
      width: 0;
      border-radius: 3px;
      background: var(--jb-ok);
      transition: width 0.25s ease;
    }
    .progress-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }

    .list {
      min-height: 0;
      overflow-y: auto;
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      border-radius: 6px;
      background: var(--vscode-editorWidget-background, transparent);
    }
    .row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 14px;
      border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    .row:last-child { border-bottom: none; }
    .row:hover { background: var(--vscode-list-hoverBackground); }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex: none;
      background: var(--jb-accent);
      /* Plain fallback first: color-mix needs Chromium 111 (VS Code 1.82+). */
      box-shadow: 0 0 0 3px rgba(217, 96, 76, 0.22);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--jb-accent) 22%, transparent);
    }
    .file { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dir { color: var(--vscode-descriptionForeground); }
    .name { font-weight: 600; }
    .badge {
      font-size: 10px;
      color: var(--jb-accent);
      border: 1px solid var(--jb-accent);
      border-radius: 8px;
      padding: 1px 7px;
      white-space: nowrap;
      opacity: 0.9;
    }

    button {
      font-family: inherit;
      font-size: 12px;
      padding: 4px 12px;
      border-radius: 3px;
      cursor: pointer;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      white-space: nowrap;
    }
    button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
    button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    button:disabled { opacity: 0.45; cursor: default; }
    .primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    .danger {
      background: transparent;
      border-color: var(--vscode-errorForeground);
      color: var(--vscode-errorForeground);
    }
    .danger:hover:not(:disabled) {
      background: var(--vscode-inputValidation-errorBackground, transparent);
    }

    .spinner {
      width: 14px;
      height: 14px;
      flex: none;
      border: 2px solid var(--vscode-descriptionForeground);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 6px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .done {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      text-align: center;
    }
    .done .ring {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid var(--jb-ok);
      color: var(--jb-ok);
    }
    .done h2 { margin: 0; font-size: 15px; font-weight: 600; color: var(--jb-ok); }
    .done p { margin: 0; font-size: 12px; color: var(--vscode-descriptionForeground); }

    footer {
      display: flex;
      align-items: center;
      gap: 8px;
      padding-top: 14px;
    }
    .spacer { flex: 1; }
    .counter { color: var(--vscode-descriptionForeground); font-size: 12px; }
  </style>
</head>
<body>
  <div class="dialog">
    <header>
      <svg class="mark" viewBox="0 0 256 256" aria-hidden="true">
        <rect width="256" height="256" rx="56" fill="#1E222A"/>
        <rect x="36" y="44" width="76" height="168" rx="10" fill="#2A303C"/>
        <rect x="144" y="44" width="76" height="168" rx="10" fill="#2A303C"/>
        <rect x="36" y="76" width="76" height="24" fill="#D95F49"/>
        <rect x="144" y="76" width="76" height="24" fill="#D95F49"/>
        <rect x="112" y="76" width="32" height="24" fill="#D95F49" opacity="0.55"/>
        <rect x="36" y="130" width="76" height="24" fill="#4E9456"/>
        <path d="M112 130 L144 140 L144 144 L112 154 Z" fill="#4E9456" opacity="0.55"/>
        <rect x="144" y="184" width="76" height="24" fill="#4173AE"/>
        <path d="M144 184 L112 194 L112 198 L144 208 Z" fill="#4173AE" opacity="0.55"/>
      </svg>
      <h1>Merge Conflicts</h1>
      <span class="chip" id="chip"></span>
    </header>
    <div class="sub" id="sub"></div>
    <div class="branches" id="branches" hidden>
      <span class="branch"><span class="who">yours</span><span id="yours"></span></span>
      <span class="arrow">⟵</span>
      <span class="branch"><span class="who">theirs</span><span id="theirs"></span></span>
    </div>

    <div class="progress-row" id="progressRow" hidden>
      <div class="bar"><div id="barFill"></div></div>
      <span class="progress-label" id="progressLabel"></span>
    </div>

    <div class="list" id="list"></div>

    <div class="done" id="done" hidden>
      <div class="ring">
        <svg width="26" height="26" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 8.5 L6.5 12 L13 4.5" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h2>All conflicts resolved</h2>
      <p id="doneSub"></p>
    </div>

    <footer>
      <button class="danger" id="abort"></button>
      <span class="spacer"></span>
      <span class="counter" id="counter"></span>
    </footer>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const el = (id) => document.getElementById(id);
    const list = el("list");

    el("abort").addEventListener("click", () => vscode.postMessage({ type: "abort" }));

    window.addEventListener("message", (event) => {
      const state = event.data;
      if (state && state.type === "state") render(state);
    });

    function cap(word) { return word.charAt(0).toUpperCase() + word.slice(1); }

    function render(state) {
      const files = state.files;
      const op = state.operation;
      const allDone = files.length === 0 && state.total > 0;

      el("chip").textContent = op + " in progress";
      el("chip").hidden = allDone;
      el("sub").textContent = allDone
        ? ""
        : "Resolve each file below, or cancel the " + op +
          " to restore the repository to the state before it started.";

      const hasBranches = !allDone && (state.yoursName || state.theirsName);
      el("branches").hidden = !hasBranches;
      if (hasBranches) {
        el("yours").textContent = state.yoursName || "HEAD";
        el("theirs").textContent = state.theirsName || "incoming";
      }

      const showProgress = state.total > 0;
      el("progressRow").hidden = !showProgress;
      if (showProgress) {
        el("barFill").style.width =
          Math.round((state.resolved / state.total) * 100) + "%";
        el("progressLabel").textContent =
          state.resolved + " of " + state.total + " resolved";
      }

      list.hidden = allDone;
      el("done").hidden = !allDone;
      el("doneSub").textContent =
        "Finishing up — this dialog will close itself.";

      const abortBtn = el("abort");
      abortBtn.textContent = "Cancel " + cap(op);
      abortBtn.disabled = Boolean(state.busyUri);
      abortBtn.hidden = allDone;

      el("counter").textContent = allDone
        ? ""
        : files.length === 1
          ? "1 conflicting file"
          : files.length + " conflicting files";

      list.replaceChildren(...files.map((file) => row(file, state)));
    }

    function row(file, state) {
      const item = document.createElement("div");
      item.className = "row";

      const dot = document.createElement("span");
      dot.className = "dot";
      item.appendChild(dot);

      const name = document.createElement("span");
      name.className = "file";
      const slash = file.rel.lastIndexOf("/");
      const dir = document.createElement("span");
      dir.className = "dir";
      dir.textContent = slash >= 0 ? file.rel.slice(0, slash + 1) : "";
      const base = document.createElement("span");
      base.className = "name";
      base.textContent = slash >= 0 ? file.rel.slice(slash + 1) : file.rel;
      name.append(dir, base);
      item.appendChild(name);

      if (file.badge) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = file.badge;
        item.appendChild(badge);
      }

      if (state.busyUri === file.uri) {
        const spinner = document.createElement("span");
        spinner.className = "spinner";
        item.appendChild(spinner);
        return item;
      }

      const busy = Boolean(state.busyUri);
      const yours = state.yoursName ? " (" + state.yoursName + ")" : "";
      const theirs = state.theirsName ? " (" + state.theirsName + ")" : "";
      item.append(
        action("Accept Yours", "Keep your version" + yours, busy,
          { type: "accept", side: "ours", uri: file.uri }),
        action("Accept Theirs", "Take the incoming version" + theirs, busy,
          { type: "accept", side: "theirs", uri: file.uri }),
        action("Merge…", "Resolve side by side in the merge editor", busy,
          { type: "merge", uri: file.uri }, "primary"),
      );
      return item;
    }

    function action(label, title, busy, message, variant) {
      const btn = document.createElement("button");
      if (variant) btn.classList.add(variant);
      btn.textContent = label;
      btn.title = title;
      btn.disabled = busy;
      btn.addEventListener("click", () => vscode.postMessage(message));
      return btn;
    }
  </script>
</body>
</html>`;
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
