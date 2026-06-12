// Git CLI helpers for conflict operations the vscode.git extension API does
// not expose (abort, accept-one-side). No vscode imports — unit-testable.
import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type GitOperation = "merge" | "rebase" | "cherry-pick" | "revert";

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args]);
  return stdout;
}

/** Whether a state file/dir inside .git exists (worktree-safe via --git-path). */
async function gitStateExists(root: string, name: string): Promise<boolean> {
  try {
    const out = (await git(root, ["rev-parse", "--git-path", name])).trim();
    const resolved = path.isAbsolute(out) ? out : path.join(root, out);
    return fs.existsSync(resolved);
  } catch {
    return false;
  }
}

/** Detects which conflict-producing operation is in progress, if any. */
export async function detectOperation(
  root: string,
): Promise<GitOperation | undefined> {
  // Rebase first: a conflicted rebase step can also leave CHERRY_PICK_HEAD.
  if (
    (await gitStateExists(root, "rebase-merge")) ||
    (await gitStateExists(root, "rebase-apply"))
  ) {
    return "rebase";
  }
  if (await gitStateExists(root, "MERGE_HEAD")) {
    return "merge";
  }
  if (await gitStateExists(root, "CHERRY_PICK_HEAD")) {
    return "cherry-pick";
  }
  if (await gitStateExists(root, "REVERT_HEAD")) {
    return "revert";
  }
  return undefined;
}

/**
 * Aborts the in-progress operation, restoring the repository to its state
 * before the operation started. Conflicted states with no operation file
 * (e.g. a stash-pop conflict) are unwound with `git reset --merge`.
 */
export async function abortOperation(
  root: string,
): Promise<GitOperation | "reset"> {
  const operation = await detectOperation(root);
  if (operation) {
    await git(root, [operation, "--abort"]);
    return operation;
  }
  await git(root, ["reset", "--merge"]);
  return "reset";
}

/**
 * Best-effort name of what is being merged in ("feature" for
 * `git merge feature`), parsed from MERGE_MSG. Undefined when unknown.
 */
export async function describeIncoming(
  root: string,
): Promise<string | undefined> {
  try {
    const msgPath = (await git(root, ["rev-parse", "--git-path", "MERGE_MSG"])).trim();
    const resolved = path.isAbsolute(msgPath) ? msgPath : path.join(root, msgPath);
    const firstLine = fs.readFileSync(resolved, "utf8").split("\n", 1)[0] ?? "";
    // Covers "Merge branch 'x'", "Merge remote-tracking branch 'origin/x'",
    // and the octopus plural "Merge branches 'a' and 'b'".
    const match = firstLine.match(
      /^Merge (?:remote-tracking branch(?:es)?|branch(?:es)?|tag|commit) (.+)/,
    );
    if (!match) {
      return undefined;
    }
    const names = match[1].match(/'([^']+)'/g)?.map((quoted) => quoted.slice(1, -1));
    return names?.length ? names.join(", ") : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves a conflicted file wholesale to one side, like the JetBrains
 * conflicts dialog's "Accept Yours / Accept Theirs". When the chosen side
 * deleted the file, accepting that side deletes the file. Optimistically
 * tries the checkout (the overwhelmingly common case) instead of probing the
 * index stages first — one fewer subprocess on the hot path.
 */
export async function acceptSide(
  root: string,
  fsPath: string,
  side: "ours" | "theirs",
): Promise<void> {
  let checkedOut = true;
  try {
    await git(root, [
      "checkout",
      side === "ours" ? "--ours" : "--theirs",
      "--",
      fsPath,
    ]);
  } catch {
    // The chosen side has no stage — it deleted the file.
    checkedOut = false;
  }
  if (checkedOut) {
    await git(root, ["add", "--", fsPath]);
  } else {
    await git(root, ["rm", "-f", "--", fsPath]);
  }
}

/**
 * Re-creates the conflicted state of a file that was already resolved and
 * staged during the in-progress merge — the conflicts dialog's "undo".
 * `git checkout -m` rebuilds the conflict from the index's resolve-undo
 * records, which git keeps exactly for this purpose.
 */
export async function restoreConflict(
  root: string,
  fsPath: string,
): Promise<void> {
  await git(root, ["checkout", "-m", "--", fsPath]);
}
