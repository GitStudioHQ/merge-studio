import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getConflictVersions, getHeadVersion, markResolved } from "../git/gitService";
import { findJetBrainsLauncher, type JetBrainsLauncher } from "./locator";

/** An embedded-editor action offered when no JetBrains IDE is installed. */
interface EmbeddedFallback {
  label: string;
  run: () => void;
}

/** Reads the configured/auto-detected JetBrains launcher without any UI. */
export function findConfiguredLauncher(): JetBrainsLauncher | undefined {
  const config = vscode.workspace.getConfiguration("jbMerge");
  return findJetBrainsLauncher(
    config.get<string>("preferredIde", "auto"),
    config.get<string>("jetbrainsPath", ""),
  );
}

/** Reads the configured/auto-detected JetBrains launcher, or warns if none. */
function resolveLauncher(
  fallback?: EmbeddedFallback,
): JetBrainsLauncher | undefined {
  const launcher = findConfiguredLauncher();
  if (!launcher) {
    void warnNotFound(fallback);
  }
  return launcher;
}

async function warnNotFound(fallback?: EmbeddedFallback): Promise<void> {
  const openSettings = "Open Settings";
  const actions = fallback ? [fallback.label, openSettings] : [openSettings];
  const choice = await vscode.window.showWarningMessage(
    "Merge Studio: no JetBrains IDE found. Install one (WebStorm, PyCharm, …) " +
      "or set its launcher path in settings.",
    ...actions,
  );
  if (choice === openSettings) {
    void vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "jbMerge.jetbrainsPath",
    );
  } else if (fallback && choice === fallback.label) {
    fallback.run();
  }
}

/** Opens the real JetBrains 3-way merge window for a conflicted file. */
export async function mergeWithJetBrains(uri: vscode.Uri): Promise<void> {
  const launcher = resolveLauncher({
    label: "Use Embedded Editor",
    run: () =>
      void vscode.commands.executeCommand("jbMerge.resolveInMergeEditor", uri),
  });
  if (!launcher) {
    return;
  }

  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument(uri);
  } catch {
    void vscode.window.showErrorMessage("Merge Studio: cannot open the file.");
    return;
  }

  const versions = await getConflictVersions(uri, document.getText());
  if (versions.source === "none") {
    void vscode.window.showWarningMessage(
      "Merge Studio: this file has no detectable conflict.",
    );
    return;
  }

  const ext = path.extname(uri.fsPath);
  const baseName = path.basename(uri.fsPath, ext);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jbmerge-"));
  const localPath = path.join(tmpDir, `${baseName}.LOCAL${ext}`);
  const remotePath = path.join(tmpDir, `${baseName}.REMOTE${ext}`);
  const basePath = path.join(tmpDir, `${baseName}.BASE${ext}`);

  fs.writeFileSync(localPath, versions.ours);
  fs.writeFileSync(remotePath, versions.theirs);

  // webstorm merge <local> <remote> [<base>] <output>; output is the real file.
  const args = ["merge", localPath, remotePath];
  if (versions.hasBase) {
    fs.writeFileSync(basePath, versions.base);
    args.push(basePath);
  }
  args.push(uri.fsPath);

  const child = cp.spawn(launcher.command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", (error) => {
    void vscode.window.showErrorMessage(
      `Merge Studio: couldn't launch ${launcher.name} — ${error.message}`,
    );
  });
  child.unref();

  const mark = "Mark Resolved & Stage";
  const choice = await vscode.window.showInformationMessage(
    `Resolving ${baseName}${ext} in ${launcher.name}. Apply the merge there, then mark it resolved.`,
    mark,
  );
  if (choice === mark) {
    const staged = await markResolved(uri);
    void vscode.window.showInformationMessage(
      staged
        ? `Merge Studio: ${baseName}${ext} staged.`
        : `Merge Studio: ${baseName}${ext} saved (not in a git repo).`,
    );
  }
  cleanup(tmpDir);
}

/** Opens the real JetBrains 2-way diff for two files. */
export async function diffFilesWithJetBrains(
  left: vscode.Uri,
  right: vscode.Uri,
): Promise<void> {
  const launcher = resolveLauncher({
    label: "Use Embedded Diff",
    run: () =>
      void vscode.commands.executeCommand("jbMerge.openDiff", undefined, [
        left,
        right,
      ]),
  });
  if (!launcher) {
    return;
  }
  spawnDetached(launcher, ["diff", left.fsPath, right.fsPath]);
}

/** Opens the real JetBrains 2-way diff of a file against its git HEAD. */
export async function diffAgainstHeadWithJetBrains(
  uri: vscode.Uri,
): Promise<void> {
  const launcher = resolveLauncher({
    label: "Use Embedded Diff",
    run: () => void vscode.commands.executeCommand("jbMerge.openChanges", uri),
  });
  if (!launcher) {
    return;
  }
  const head = await getHeadVersion(uri);
  if (!head) {
    void vscode.window.showWarningMessage(
      "Merge Studio: no git HEAD version found for this file.",
    );
    return;
  }
  const ext = path.extname(uri.fsPath);
  const baseName = path.basename(uri.fsPath, ext);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jbdiff-"));
  const headPath = path.join(tmpDir, `${baseName}.HEAD${ext}`);
  fs.writeFileSync(headPath, head.text);

  // Left = HEAD (read-only side), right = the working-tree file.
  spawnDetached(launcher, ["diff", headPath, uri.fsPath]);
  // Give the IDE time to read the temp file before cleanup.
  setTimeout(() => cleanup(tmpDir), 60_000);
}

function spawnDetached(launcher: JetBrainsLauncher, args: string[]): void {
  const child = cp.spawn(launcher.command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", (error) => {
    void vscode.window.showErrorMessage(
      `Merge Studio: couldn't launch ${launcher.name} — ${error.message}`,
    );
  });
  child.unref();
}

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}
