import * as vscode from "vscode";
import { MergeEditorProvider } from "./mergeEditorProvider";
import { ConflictsPanel } from "./conflictsPanel";
import { DiffPanel, type DiffPanelState } from "./diffPanel";
import {
  findRepoWithConflicts,
  getHeadVersion,
  isConflicted,
  watchRepositories,
  type Repository,
} from "./git/gitService";
import {
  clearAutoOpenSuppression,
  isAutoOpenSuppressed,
} from "./conflict/exitGuard";
import {
  diffAgainstHeadWithJetBrains,
  diffFilesWithJetBrains,
  findConfiguredLauncher,
  mergeWithJetBrains,
} from "./jetbrains/launcher";
import { DEMO_DIFF, DEMO_MERGE } from "./demoContent";

const COEXIST_PROMPT_KEY = "jbMerge.coexistPromptShown";
const WALKTHROUGH_SHOWN_KEY = "jbMerge.walkthroughShown";
const WALKTHROUGH_ID = "gitstudio.merge-studio#mergeStudio.gettingStarted";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(MergeEditorProvider.register(context));
  context.subscriptions.push(DiffPanel.register(context));
  registerIdeAvailabilityContext(context);
  registerAutoOpen(context);
  registerMergeTabReroute(context);
  registerConflictsDialog(context);
  registerWalkthrough(context);
  registerDemos(context);
  void maybeOfferCoexistence(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("jbMerge.showConflicts", async () => {
      const repo = await findRepoWithConflicts();
      if (!repo) {
        void vscode.window.showInformationMessage(
          "Merge Studio: no merge conflicts in the open repositories.",
        );
        return;
      }
      ConflictsPanel.show(repo);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jbMerge.resolveInMergeEditor",
      async (arg?: unknown) => {
        const uri =
          resolveUriArg(arg) ?? vscode.window.activeTextEditor?.document.uri;
        if (!uri) {
          void vscode.window.showWarningMessage(
            "Merge Studio: no file selected to open in the merge editor.",
          );
          return;
        }
        await vscode.commands.executeCommand(
          "vscode.openWith",
          uri,
          MergeEditorProvider.viewType,
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jbMerge.openDiff",
      (clicked?: unknown, selected?: unknown) =>
        openDiff(context, clicked, selected),
    ),
  );

  // Editor-title / palette entry: always working-tree vs HEAD for the target.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jbMerge.openChanges",
      async (arg?: unknown) => {
        const uri =
          resolveUriArg(arg) ?? vscode.window.activeTextEditor?.document.uri;
        if (!uri) {
          void vscode.window.showWarningMessage(
            "Merge Studio: open a file to compare it against HEAD.",
          );
          return;
        }
        const head = await getHeadVersion(uri);
        if (!head) {
          void vscode.window.showWarningMessage(
            "Merge Studio: no git HEAD version found for this file.",
          );
          return;
        }
        await DiffPanel.create(context, headState(uri, head.ref));
      },
    ),
  );

  // --- Real JetBrains IDE (shell-out) commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jbMerge.mergeWithJetBrains",
      async (arg?: unknown) => {
        const uri =
          resolveUriArg(arg) ?? vscode.window.activeTextEditor?.document.uri;
        if (!uri) {
          void vscode.window.showWarningMessage(
            "Merge Studio: no conflicted file selected.",
          );
          return;
        }
        await mergeWithJetBrains(uri);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jbMerge.diffWithJetBrains",
      (clicked?: unknown, selected?: unknown) =>
        diffWithJetBrains(clicked, selected),
    ),
  );

  // Routed "Compare" entry: one menu item that honors the jbMerge.diffTool
  // setting — the embedded diff by default, the real JetBrains IDE when chosen
  // (and installed; otherwise it quietly uses the embedded diff).
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "jbMerge.compare",
      (clicked?: unknown, selected?: unknown) => {
        const tool = vscode.workspace
          .getConfiguration("jbMerge")
          .get<string>("diffTool", "embedded");
        if (tool === "jetbrains" && findConfiguredLauncher()) {
          return diffWithJetBrains(clicked, selected);
        }
        return openDiff(context, clicked, selected);
      },
    ),
  );
}

/**
 * Resolves the two sides for a JetBrains-style diff from the invocation context:
 *  - exactly two files selected in the explorer -> diff those two
 *  - one file selected / editor title / palette -> working tree vs its HEAD
 */
async function openDiff(
  context: vscode.ExtensionContext,
  clicked?: unknown,
  selected?: unknown,
): Promise<void> {
  const selectedUris = collectUris(selected);

  if (selectedUris.length === 2) {
    await DiffPanel.create(context, twoFileState(selectedUris[0], selectedUris[1]));
    return;
  }

  const uri =
    resolveUriArg(clicked) ??
    selectedUris[0] ??
    vscode.window.activeTextEditor?.document.uri;
  if (!uri) {
    void vscode.window.showWarningMessage(
      "Merge Studio: open a file or select two files to compare.",
    );
    return;
  }

  const head = await getHeadVersion(uri);
  if (!head) {
    void vscode.window.showWarningMessage(
      "Merge Studio: no git HEAD version found for this file.",
    );
    return;
  }
  await DiffPanel.create(context, headState(uri, head.ref));
}

/**
 * JetBrains-IDE diff with the same target resolution as {@link openDiff}: two
 * selected files diff against each other; otherwise the file vs its git HEAD.
 */
async function diffWithJetBrains(
  clicked?: unknown,
  selected?: unknown,
): Promise<void> {
  const selectedUris = collectUris(selected);
  if (selectedUris.length === 2) {
    await diffFilesWithJetBrains(selectedUris[0], selectedUris[1]);
    return;
  }
  const uri =
    resolveUriArg(clicked) ??
    selectedUris[0] ??
    vscode.window.activeTextEditor?.document.uri;
  if (!uri) {
    void vscode.window.showWarningMessage(
      "Merge Studio: open a file or select two files to compare.",
    );
    return;
  }
  await diffAgainstHeadWithJetBrains(uri);
}

/** Working tree (current file, editable) vs HEAD (read-only). */
function headState(uri: vscode.Uri, ref: string): DiffPanelState {
  return {
    fileName: uri.fsPath,
    leftLabel: `HEAD (${ref})`,
    rightLabel: "Working Tree",
    leftSource: "head",
    leftUri: uri.toString(),
    rightUri: uri.toString(),
    rightEditable: true,
  };
}

/** Two explorer files: left read-only, right editable. */
function twoFileState(left: vscode.Uri, right: vscode.Uri): DiffPanelState {
  return {
    fileName: right.fsPath,
    leftLabel: left.fsPath.split(/[\\/]/).pop() ?? left.fsPath,
    rightLabel: right.fsPath.split(/[\\/]/).pop() ?? right.fsPath,
    leftSource: "uri",
    leftUri: left.toString(),
    rightUri: right.toString(),
    rightEditable: true,
  };
}

/**
 * First-run prompt offering to disable the built-in merge UI so it doesn't
 * compete. Only ever shown once, and only applies settings on explicit consent.
 */
/**
 * Wires the "Getting Started" walkthrough: a command to (re)open it on demand,
 * and a one-time auto-open on first activation after install. VS Code features
 * contributed walkthroughs on the Welcome page automatically, but that only
 * surfaces when the welcome page is the startup editor — opening it once here
 * guarantees first-run onboarding regardless of that setting.
 */
function registerWalkthrough(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("jbMerge.openWalkthrough", () =>
      vscode.commands.executeCommand(
        "workbench.action.openWalkthrough",
        WALKTHROUGH_ID,
        false,
      ),
    ),
  );

  if (context.globalState.get<boolean>(WALKTHROUGH_SHOWN_KEY)) {
    return;
  }
  void context.globalState.update(WALKTHROUGH_SHOWN_KEY, true);
  void vscode.commands.executeCommand(
    "workbench.action.openWalkthrough",
    WALKTHROUGH_ID,
    false,
  );
}

/**
 * The walkthrough's "try it" actions. Both work on a fresh install with NO git
 * setup: the merge demo writes a sample carrying diff3 conflict markers (the
 * merge editor reconstructs base/ours/theirs from them), and the diff demo
 * feeds two inline texts straight into the diff panel.
 */
function registerDemos(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("jbMerge.openDemo", async () => {
      const dir = vscode.Uri.joinPath(context.globalStorageUri, "demo");
      await vscode.workspace.fs.createDirectory(dir);
      const uri = vscode.Uri.joinPath(dir, DEMO_MERGE.fileName);
      // Rewrite the pristine sample every time so it always opens unresolved,
      // even after a previous run resolved it.
      await vscode.workspace.fs.writeFile(
        uri,
        Buffer.from(DEMO_MERGE.body, "utf8"),
      );
      await vscode.commands.executeCommand(
        "vscode.openWith",
        uri,
        MergeEditorProvider.viewType,
      );
    }),
    vscode.commands.registerCommand("jbMerge.openDemoDiff", async () => {
      await DiffPanel.create(context, {
        fileName: DEMO_DIFF.fileName,
        leftLabel: DEMO_DIFF.leftLabel,
        rightLabel: DEMO_DIFF.rightLabel,
        rightEditable: false,
        leftSource: "text",
        leftText: DEMO_DIFF.leftText,
        rightText: DEMO_DIFF.rightText,
      });
    }),
  );
}

async function maybeOfferCoexistence(
  context: vscode.ExtensionContext,
): Promise<void> {
  if (context.globalState.get<boolean>(COEXIST_PROMPT_KEY)) {
    return;
  }
  await context.globalState.update(COEXIST_PROMPT_KEY, true);

  const accept = "Disable built-ins";
  const choice = await vscode.window.showInformationMessage(
    "Merge Studio: disable VS Code's built-in merge editor and " +
      "merge-conflict decorations so they don't compete?",
    accept,
    "Keep them",
  );
  if (choice !== accept) {
    return;
  }
  const config = vscode.workspace.getConfiguration();
  const target = vscode.ConfigurationTarget.Global;
  await config.update("git.mergeEditor", false, target);
  await config.update("merge-conflict.codeLens.enabled", false, target);
  await config.update("merge-conflict.decorators.enabled", false, target);
  void vscode.window.showInformationMessage(
    "Merge Studio: built-in merge UI disabled.",
  );
}

/** Normalizes a command's selection argument into a list of file Uris. */
function collectUris(arg: unknown): vscode.Uri[] {
  if (!Array.isArray(arg)) {
    return [];
  }
  const uris: vscode.Uri[] = [];
  for (const item of arg) {
    const uri = resolveUriArg(item);
    if (uri) {
      uris.push(uri);
    }
  }
  return uris;
}

export function deactivate(): void {
  // Nothing to clean up beyond context.subscriptions.
}

/**
 * Conflict-session UI driven by repository state:
 *  - a warning status-bar button ("⚠ Resolve Conflicts") while any conflicts
 *    remain, opening the Conflicts dialog;
 *  - opens the dialog the moment an operation produces conflicts (like
 *    JetBrains' conflicts dialog) and keeps bringing it back on git state
 *    changes until every conflict is resolved or the merge is cancelled.
 */
function registerConflictsDialog(context: vscode.ExtensionContext): void {
  const conflictCounts = new Map<string, number>();

  const statusItem = vscode.window.createStatusBarItem(
    "jbMerge.conflicts",
    vscode.StatusBarAlignment.Left,
    10000,
  );
  statusItem.name = "Merge Studio: Conflicts";
  statusItem.text = "$(warning) Resolve Conflicts";
  statusItem.command = "jbMerge.showConflicts";
  statusItem.backgroundColor = new vscode.ThemeColor(
    "statusBarItem.warningBackground",
  );
  context.subscriptions.push(statusItem);

  const updateStatusItem = () => {
    let total = 0;
    conflictCounts.forEach((count) => (total += count));
    if (total === 0) {
      statusItem.hide();
      return;
    }
    statusItem.tooltip =
      (total === 1 ? "1 conflicting file" : `${total} conflicting files`) +
      " — open the conflicts dialog";
    statusItem.show();
  };

  // Instant conflict detection: vscode.git's own watcher can lag a merge by
  // a second or more. Watching the .git operation-state files directly and
  // poking repo.status() the moment one appears makes mergeChanges (and so
  // the dialog) update near-instantly.
  const opStateWatched = new Set<string>();
  const watchOpStateFiles = (repo: Repository) => {
    const key = repo.rootUri.toString();
    if (opStateWatched.has(key)) {
      return;
    }
    opStateWatched.add(key);
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.joinPath(repo.rootUri, ".git"),
        "{MERGE_HEAD,CHERRY_PICK_HEAD,REVERT_HEAD,rebase-merge,rebase-apply}",
      ),
    );
    const poke = () => void repo.status?.();
    watcher.onDidCreate(poke);
    watcher.onDidChange(poke);
    watcher.onDidDelete(poke);
    context.subscriptions.push(watcher);
  };

  watchRepositories(context, (repo) => {
    watchOpStateFiles(repo);
    const key = repo.rootUri.toString();
    const conflictCount = repo.state.mergeChanges.length;
    conflictCounts.set(key, conflictCount);
    updateStatusItem();
    if (conflictCount > 0) {
      ConflictsPanel.ensureVisible(repo);
    }
  });
}

/**
 * Keeps the `jbMerge.ideAvailable` context key in sync with whether a JetBrains
 * IDE is actually installed, so JetBrains menu entries hide when launching one
 * could only fail. Re-evaluated when jbMerge settings change (preferredIde /
 * jetbrainsPath can make an IDE reachable without a reload).
 */
function registerIdeAvailabilityContext(context: vscode.ExtensionContext): void {
  const update = () =>
    void vscode.commands.executeCommand(
      "setContext",
      "jbMerge.ideAvailable",
      Boolean(findConfiguredLauncher()),
    );
  update();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("jbMerge")) {
        update();
      }
    }),
  );
}

/** One-time notice that conflicts are routed to the embedded editor instead. */
let embeddedFallbackNotified = false;
function notifyEmbeddedFallback(): void {
  if (embeddedFallbackNotified) {
    return;
  }
  embeddedFallbackNotified = true;
  const openSettings = "Open Settings";
  void vscode.window
    .showInformationMessage(
      "Merge Studio: no JetBrains IDE found — using the embedded merge " +
        "editor instead. Install an IDE or set its launcher path to use the " +
        "real merge window.",
      openSettings,
    )
    .then((choice) => {
      if (choice === openSettings) {
        void vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "jbMerge.jetbrainsPath",
        );
      }
    });
}

/**
 * Auto-routes conflicted files into the JetBrains-style merge editor when they
 * become the active text editor (superseding the built-in editor). Controlled
 * by the `jbMerge.autoOpen` setting; guarded against re-entrant routing.
 */
function registerAutoOpen(context: vscode.ExtensionContext): void {
  const recentlyRouted = new Set<string>();
  // Files we've already launched the external IDE for this session, so we don't
  // pop a new WebStorm window every time the editor regains focus.
  const launchedInIde = new Set<string>();

  const maybeRoute = async (editor: vscode.TextEditor | undefined) => {
    if (!editor) {
      return;
    }
    const config = vscode.workspace.getConfiguration("jbMerge");
    if (!config.get<boolean>("autoOpen", true)) {
      return;
    }
    const uri = editor.document.uri;
    if (uri.scheme !== "file") {
      return;
    }
    const key = uri.toString();
    if (recentlyRouted.has(key)) {
      return;
    }
    if (!(await isConflicted(uri))) {
      launchedInIde.delete(key); // resolved/closed — allow a future re-launch
      clearAutoOpenSuppression(uri);
      return;
    }
    if (isAutoOpenSuppressed(uri)) {
      return; // the user explicitly exited the viewer for this conflict
    }
    recentlyRouted.add(key);
    setTimeout(() => recentlyRouted.delete(key), 1500);

    const resolver = config.get<string>("conflictResolver", "webview");
    if (resolver === "jetbrains" && findConfiguredLauncher()) {
      if (!launchedInIde.has(key)) {
        launchedInIde.add(key);
        await mergeWithJetBrains(uri);
      }
      return;
    }
    if (resolver === "jetbrains") {
      notifyEmbeddedFallback();
    }
    await vscode.commands.executeCommand(
      "vscode.openWith",
      uri,
      MergeEditorProvider.viewType,
    );
  };

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => void maybeRoute(editor)),
  );
  void maybeRoute(vscode.window.activeTextEditor);
}

/**
 * Replaces VS Code's built-in 3-way merge editor (which opens for conflicted
 * files when git.mergeEditor is on, and which a TextEditor listener can't catch)
 * with our resolver. This is what guarantees the user sees clean code instead of
 * the built-in editor's raw <<<<<<< markers.
 */
function registerMergeTabReroute(context: vscode.ExtensionContext): void {
  const rerouted = new Set<string>();

  const handle = async () => {
    const config = vscode.workspace.getConfiguration("jbMerge");
    if (!config.get<boolean>("autoOpen", true)) {
      return;
    }
    const resolver = config.get<string>("conflictResolver", "webview");

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        // Duck-type the built-in merge editor tab (TabInputTextMerge): it
        // uniquely carries input1/input2/result Uris. Typed this way so we
        // don't depend on a vscode API newer than our engines.vscode baseline.
        const input = tab.input as
          | { input1?: vscode.Uri; input2?: vscode.Uri; result?: vscode.Uri }
          | undefined;
        if (!input?.result || !input.input1 || !input.input2) {
          continue;
        }
        const uri = input.result;
        const key = uri.toString();
        if (rerouted.has(key)) {
          continue;
        }
        rerouted.add(key);
        setTimeout(() => rerouted.delete(key), 3000);

        try {
          await vscode.window.tabGroups.close(tab);
        } catch {
          // tab already gone
        }
        if (resolver === "jetbrains" && findConfiguredLauncher()) {
          await mergeWithJetBrains(uri);
        } else {
          if (resolver === "jetbrains") {
            notifyEmbeddedFallback();
          }
          await vscode.commands.executeCommand(
            "vscode.openWith",
            uri,
            MergeEditorProvider.viewType,
          );
        }
      }
    }
  };

  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(() => void handle()),
  );
  void handle();
}

/** SCM/explorer menu commands pass a resource state or Uri; normalize to a Uri. */
function resolveUriArg(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri) {
    return arg;
  }
  if (arg && typeof arg === "object") {
    const candidate = (arg as { resourceUri?: unknown }).resourceUri;
    if (candidate instanceof vscode.Uri) {
      return candidate;
    }
  }
  return undefined;
}
