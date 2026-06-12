// JetBrains-style "Conflicts" dialog controller: lists every conflicted file
// with Accept Yours / Accept Theirs / Merge actions, keeps resolved files
// visible (green, with the chosen side and a hold-to-undo), stays in sync
// with git state, and can cancel the whole merge request. The webview
// document itself lives in conflictsHtml.ts (vscode-free, harness-testable).
import * as vscode from "vscode";
import * as path from "path";
import type { Repository } from "./git/git";
import {
  acceptSide,
  detectOperation,
  describeIncoming,
  restoreConflict,
  type GitOperation,
} from "./git/mergeOps";
import {
  closeMergeEditorTabs,
  confirmAndAbortMergeRequest,
} from "./git/abortFlow";
import { findConfiguredLauncher } from "./jetbrains/launcher";
import { renderConflictsHtml } from "./conflictsHtml";

/** What the user chose for a file this session. */
type Choice = "yours" | "theirs" | "merged";

/** One file as shown in the dialog. */
interface ConflictRow {
  uri: string;
  /** Path relative to the repository root, for display. */
  rel: string;
  /** Special conflict kind ("deleted by them", …); "" for both-modified. */
  badge: string;
  status: "pending" | "busy" | "resolved";
  choice: Choice | null;
}

interface FileInfo {
  fsPath: string;
  rel: string;
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
  | { type: "undo"; uri: string }
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
  /** Every conflict seen this session, with display info that must survive
   *  the file leaving mergeChanges (resolved rows stay in the list). */
  private readonly files = new Map<string, FileInfo>();
  /** How each file was resolved (absent = via merge editor / externally). */
  private readonly choices = new Map<string, Choice>();
  /** Resolved by us but git's watcher hasn't caught up yet. */
  private readonly optimisticResolved = new Set<string>();
  /** Conflict restored by undo but not yet re-listed by git. */
  private readonly optimisticRestored = new Set<string>();
  private lastPending: number | undefined;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Uri currently being accepted/undone (its row shows a spinner). */
  private busyUri: string | undefined;
  /** Guards refresh() calls that resolve after the panel was disposed. */
  private disposed = false;
  /** detectOperation result cache — it costs several git subprocesses. */
  private opCache: { op: GitOperation | undefined; pending: number } | undefined;
  /** describeIncoming is stable for the whole merge; null = none found. */
  private incoming: string | null | undefined;

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
    const pendingNow = new Set<string>();
    for (const change of this.repo.state.mergeChanges) {
      const key = change.uri.toString();
      pendingNow.add(key);
      if (!this.files.has(key)) {
        this.files.set(key, {
          fsPath: change.uri.fsPath,
          // Forward slashes even on Windows: display-only, and the webview
          // splits dir/name on "/".
          rel: path
            .relative(this.root, change.uri.fsPath)
            .split(path.sep)
            .join("/"),
          badge: STATUS_BADGE[change.status] ?? "",
        });
      }
    }

    // Optimistic state reconciliation: drop overrides once git caught up.
    for (const uri of [...this.optimisticResolved]) {
      if (!pendingNow.has(uri)) {
        this.optimisticResolved.delete(uri);
      }
    }
    for (const uri of [...this.optimisticRestored]) {
      if (pendingNow.has(uri)) {
        this.optimisticRestored.delete(uri);
      }
    }

    const rows: ConflictRow[] = [...this.files.entries()]
      .map(([uri, info]) => {
        const pending = pendingNow.has(uri) && !this.optimisticResolved.has(uri);
        const busy = uri === this.busyUri || this.optimisticRestored.has(uri);
        const status: ConflictRow["status"] = busy
          ? "busy"
          : pending
            ? "pending"
            : "resolved";
        // A conflict that came back (undo, new merge step) clears its choice.
        if (status === "pending") {
          this.choices.delete(uri);
        }
        return {
          uri,
          rel: info.rel,
          badge: info.badge,
          status,
          choice:
            status === "resolved"
              ? (this.choices.get(uri) ?? "merged")
              : null,
        };
      })
      .sort((a, b) => a.rel.localeCompare(b.rel));

    const pendingCount = rows.filter((r) => r.status !== "resolved").length;
    const total = this.files.size;
    if (pendingCount > 0) {
      this.hadConflicts = true;
      if (this.closeTimer) {
        clearTimeout(this.closeTimer);
        this.closeTimer = undefined;
      }
    }

    // detectOperation costs several subprocesses — reuse the cached answer
    // while the pending count is unchanged. Always recompute at zero pending
    // (that's where external aborts must be noticed).
    let op: GitOperation | undefined;
    if (
      this.opCache &&
      this.opCache.pending === pendingCount &&
      pendingCount > 0
    ) {
      op = this.opCache.op;
    } else {
      op = await detectOperation(this.root);
      if (this.disposed) {
        return; // disposed while awaiting git
      }
      this.opCache = { op, pending: pendingCount };
    }
    if (pendingCount === 0 && this.hadConflicts && !op) {
      // Merge aborted/completed elsewhere — no success theater, just close.
      this.panel.dispose();
      return;
    }

    // A conflict just got resolved: bring the dialog back to the front (the
    // JetBrains flow — finishing a file returns you to the conflicts list).
    if (this.lastPending !== undefined && pendingCount < this.lastPending) {
      this.panel.reveal();
    }
    this.lastPending = pendingCount;

    this.panel.title =
      pendingCount > 0 ? `Conflicts (${pendingCount})` : "Conflicts";

    const operation = op ?? "merge";
    if (this.incoming === undefined && operation === "merge") {
      this.incoming = (await describeIncoming(this.root)) ?? null;
      if (this.disposed) {
        return;
      }
    }
    void this.panel.webview.postMessage({
      type: "state",
      operation,
      yoursName: this.repo.state.HEAD?.name ?? null,
      theirsName: this.incoming ?? null,
      files: rows,
      busy: Boolean(this.busyUri),
      total,
      resolved: total - pendingCount,
    });

    // All conflicts resolved: keep the green list around for review/undo,
    // then close on its own.
    if (pendingCount === 0 && this.hadConflicts && !this.closeTimer) {
      this.closeTimer = setTimeout(() => this.panel.dispose(), 6000);
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
      case "undo":
        await this.undo(message.uri);
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
      this.choices.set(uriString, side === "ours" ? "yours" : "theirs");
      this.optimisticResolved.add(uriString);
      // Fire-and-forget cleanups: the row must not wait for them.
      void closeMergeEditorTabs(uri); // a merge editor here would show a stale conflict
      void this.repo.status?.(); // poke vscode.git to re-scan now, not in ~1s
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

  /** Hold-to-undo: restore the conflicted state of an already-resolved file. */
  private async undo(uriString: string): Promise<void> {
    if (this.busyUri) {
      return;
    }
    this.busyUri = uriString;
    void this.refresh();
    const uri = vscode.Uri.parse(uriString);
    try {
      await restoreConflict(this.root, uri.fsPath);
      this.choices.delete(uriString);
      this.optimisticResolved.delete(uriString);
      this.optimisticRestored.add(uriString);
      void this.repo.status?.();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        `Merge Studio: couldn't restore the conflict in ${path.basename(uri.fsPath)} — ${reason}`,
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
