// UI flow around aborting a merge/rebase/cherry-pick: saving conflicted
// buffers, running the abort, and cleaning up open merge-editor tabs.
import * as vscode from "vscode";
import { abortOperation, detectOperation } from "./mergeOps";

// Must match the customEditors viewType contributed in package.json. Kept as a
// literal so this module doesn't import MergeEditorProvider (which imports us).
const MERGE_EDITOR_VIEW_TYPE = "jbMerge.mergeEditor";

/** Human name of the in-progress operation ("merge" when indeterminate). */
async function describeOperation(root: string): Promise<string> {
  return (await detectOperation(root)) ?? "merge";
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Aborts the in-progress operation, restoring the repository to its state
 * before the operation started. Saves the given (conflicted) documents first
 * so no dirty buffers fight the checkout, and closes any open JetBrains-style
 * merge editor tabs, which would otherwise show stale conflicts.
 * Returns true when the repository was restored.
 */
export async function abortMergeRequest(
  root: string,
  saveUris: vscode.Uri[],
): Promise<boolean> {
  const toSave = new Set(saveUris.map((uri) => uri.toString()));
  for (const document of vscode.workspace.textDocuments) {
    if (document.isDirty && toSave.has(document.uri.toString())) {
      try {
        await document.save();
      } catch {
        // The abort overwrites the file anyway.
      }
    }
  }

  const operation = await describeOperation(root);
  try {
    await abortOperation(root);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(
      `Merge Studio: couldn't cancel the ${operation} — ${reason}`,
    );
    return false;
  }

  await closeMergeEditorTabs();
  void vscode.window.showInformationMessage(
    `Merge Studio: ${operation} cancelled — the repository was restored ` +
      "to its previous state.",
  );
  return true;
}

/** Modal confirmation, then abortMergeRequest. True when actually aborted. */
export async function confirmAndAbortMergeRequest(
  root: string,
  saveUris: vscode.Uri[],
): Promise<boolean> {
  const operation = await describeOperation(root);
  const button = `Cancel ${capitalize(operation)}`;
  const choice = await vscode.window.showWarningMessage(
    `Cancel the ${operation} in progress?`,
    {
      modal: true,
      detail:
        `The repository will be restored to its state before the ${operation} ` +
        "started. Partial conflict resolutions will be lost.",
    },
    button,
  );
  if (choice !== button) {
    return false;
  }
  return abortMergeRequest(root, saveUris);
}

/** Closes JetBrains-style merge editor tabs (all, or just one file's). */
export async function closeMergeEditorTabs(matching?: vscode.Uri): Promise<void> {
  const target = matching?.toString();
  const tabs = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => {
      // Duck-typed TabInputCustom, like the merge-tab reroute in extension.ts.
      const input = tab.input as
        | { viewType?: string; uri?: vscode.Uri }
        | undefined;
      if (input?.viewType !== MERGE_EDITOR_VIEW_TYPE) {
        return false;
      }
      return !target || input.uri?.toString() === target;
    });
  if (tabs.length === 0) {
    return;
  }
  try {
    await vscode.window.tabGroups.close(tabs);
  } catch {
    // tabs already gone
  }
}
