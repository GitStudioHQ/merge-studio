import * as vscode from "vscode";
import { getWebviewHtml } from "./webview/html";
import { getConflictVersions, getRepoRoot, markResolved } from "./git/gitService";
import { abortMergeRequest } from "./git/abortFlow";
import { suppressAutoOpen } from "./conflict/exitGuard";
import { findConfiguredLauncher } from "./jetbrains/launcher";
import type { WebviewMessage } from "./shared/protocol";

/**
 * Hosts the JetBrains-style 3-way merge UI inside a webview, backed by the
 * conflicted file's TextDocument (so save / dirty / undo come from VSCode).
 *
 * Resolves base/ours/theirs (git stages, with a marker fallback) and streams
 * them to the webview, which renders them as three Monaco panes
 * (webview/mergeView.ts).
 */
export class MergeEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "jbMerge.mergeEditor";

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new MergeEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(
      MergeEditorProvider.viewType,
      provider,
      {
        supportsMultipleEditorsPerDocument: false,
        webviewOptions: { retainContextWhenHidden: true },
      },
    );
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const webview = webviewPanel.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
      ],
    };
    webview.html = getWebviewHtml(webview, this.context.extensionUri);

    const messageSub = webview.onDidReceiveMessage((raw: unknown) => {
      const message = raw as WebviewMessage | undefined;
      switch (message?.type) {
        case "ready":
          void this.sendInit(document, webview);
          break;
        case "resultChanged":
          void this.syncDocument(document, message.text);
          break;
        case "apply":
          void this.applyMerge(document, webview, message.text);
          break;
        case "cancel":
          void this.cancelMerge(document, webviewPanel);
          break;
        case "openInJetBrains":
          this.openInJetBrains(document, webviewPanel);
          break;
        default:
          break;
      }
    });

    webviewPanel.onDidDispose(() => {
      messageSub.dispose();
    });
  }

  /**
   * The dialog's Cancel: ask whether to just leave the viewer (keeping the
   * conflict in the file for later) or cancel the whole merge request,
   * restoring the repository to its pre-merge state.
   */
  private async cancelMerge(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    const exit = "Exit Viewer";
    const abort = "Cancel Merge Request";
    const choice = await vscode.window.showWarningMessage(
      "Leave the merge viewer?",
      {
        modal: true,
        detail:
          "Exit Viewer closes this editor and keeps the conflict in the " +
          "file so you can resolve it later.\n\n" +
          "Cancel Merge Request aborts the merge and restores the " +
          "repository to its state before the merge started.",
      },
      exit,
      abort,
    );
    if (!choice) {
      return; // dismissed — keep merging
    }

    if (choice === exit) {
      suppressAutoOpen(document.uri);
      try {
        await vscode.commands.executeCommand(
          "vscode.openWith",
          document.uri,
          "default",
          webviewPanel.viewColumn ?? vscode.ViewColumn.Active,
        );
      } finally {
        webviewPanel.dispose();
      }
      return;
    }

    const root = await getRepoRoot(document.uri);
    if (!root) {
      void vscode.window.showWarningMessage(
        "Merge Studio: this file isn't in a git repository — there is " +
          "no merge request to cancel.",
      );
      return;
    }
    const aborted = await abortMergeRequest(root, [document.uri]);
    if (aborted) {
      webviewPanel.dispose(); // usually already closed with the other tabs
    }
  }

  /**
   * The footer's "Open in <IDE>" button: hand the conflict to the real
   * JetBrains merge window and close this panel so the two don't fight over
   * the file. Fire-and-forget — the command awaits its own notification.
   */
  private openInJetBrains(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): void {
    void vscode.commands.executeCommand(
      "jbMerge.mergeWithJetBrains",
      document.uri,
    );
    webviewPanel.dispose();
  }

  /** Mirrors the webview's resolved result into the backing TextDocument. */
  private async syncDocument(
    document: vscode.TextDocument,
    text: string,
  ): Promise<void> {
    if (document.getText() === text) {
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      new vscode.Position(0, 0),
      new vscode.Position(document.lineCount, 0),
    );
    edit.replace(document.uri, fullRange, text);
    await vscode.workspace.applyEdit(edit);
  }

  /** Writes the result, saves it, and stages the file (canonical "resolved"). */
  private async applyMerge(
    document: vscode.TextDocument,
    webview: vscode.Webview,
    text: string,
  ): Promise<void> {
    try {
      await this.syncDocument(document, text);
      await document.save();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        `Merge Studio: failed to save the resolved file — ${reason}`,
      );
      return;
    }
    // Staging is best-effort: the resolution is already saved on disk, so a
    // git hiccup must not read as a failed merge.
    let staged = false;
    try {
      staged = await markResolved(document.uri);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      void vscode.window.showWarningMessage(
        `Merge Studio: file saved, but staging failed (${reason}). ` +
          "Stage it manually with git add.",
      );
      void webview.postMessage({ type: "applied", staged: false });
      return;
    }
    void webview.postMessage({ type: "applied", staged });
    void vscode.window.showInformationMessage(
      staged
        ? "Merge Studio: resolved file saved and staged."
        : "Merge Studio: resolved file saved.",
    );
  }

  private async sendInit(
    document: vscode.TextDocument,
    webview: vscode.Webview,
  ): Promise<void> {
    try {
      const payload = await getConflictVersions(
        document.uri,
        document.getText(),
      );
      void webview.postMessage({
        type: "init",
        ...payload,
        jetbrainsName: findConfiguredLauncher()?.name,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        `Merge Studio: failed to load conflict versions — ${reason}`,
      );
    }
  }
}
