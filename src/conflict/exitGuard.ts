// Files whose merge viewer the user explicitly exited ("get me out, I'll
// resolve this later"). Auto-open must not route them straight back into the
// merge editor; the suppression lifts once the file's conflict is gone.
import type * as vscode from "vscode";

const exited = new Set<string>();

export function suppressAutoOpen(uri: vscode.Uri): void {
  exited.add(uri.toString());
}

export function clearAutoOpenSuppression(uri: vscode.Uri): void {
  exited.delete(uri.toString());
}

export function isAutoOpenSuppressed(uri: vscode.Uri): boolean {
  return exited.has(uri.toString());
}
