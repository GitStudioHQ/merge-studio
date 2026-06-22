import * as vscode from "vscode";
import type { API, GitExtension, Repository } from "./git";
import { parseConflictMarkers } from "../conflict/markers";
import type {
  ConflictType,
  MergeInitPayload,
  VersionsSource,
} from "../shared/protocol";

/** Cached git API handle; resolved lazily on first use. */
let cachedApi: API | undefined;

async function getGitApi(): Promise<API | undefined> {
  if (cachedApi) {
    return cachedApi;
  }
  const extension =
    vscode.extensions.getExtension<GitExtension>("vscode.git");
  if (!extension) {
    return undefined;
  }
  const exports = extension.isActive
    ? extension.exports
    : await extension.activate();
  if (!exports.enabled) {
    return undefined;
  }
  cachedApi = exports.getAPI(1);
  return cachedApi;
}

/** Reads one git stage; resolves to undefined if the stage is absent/empty. */
async function showStage(
  repo: Repository,
  stageRef: string,
  fsPath: string,
): Promise<string | undefined> {
  try {
    const content = await repo.show(stageRef, fsPath);
    // Some conflict kinds yield an empty buffer rather than throwing.
    return content.length > 0 ? content : undefined;
  } catch {
    return undefined;
  }
}

function classifyConflict(
  base: string | undefined,
  ours: string | undefined,
  theirs: string | undefined,
): ConflictType {
  if (ours !== undefined && theirs !== undefined) {
    return base !== undefined ? "content" : "add-add";
  }
  if (ours !== undefined && theirs === undefined) {
    return "deleted-by-them";
  }
  if (ours === undefined && theirs !== undefined) {
    return "deleted-by-us";
  }
  return "unknown";
}

/**
 * Resolves the three sides of a conflicted file. Prefers git index stages; if
 * those are unavailable (no repo, non-content conflict, or stage read failure)
 * it falls back to reconstructing the sides from the working-tree markers.
 */
export async function getConflictVersions(
  uri: vscode.Uri,
  documentText: string,
): Promise<MergeInitPayload> {
  const fileName = uri.fsPath;
  let source: VersionsSource = "none";
  // IntelliJ's merge dialog wording.
  let oursLabel = "Your version";
  const theirsLabel = "Changes from server";

  const api = await getGitApi();
  const repo = api?.getRepository(uri) ?? undefined;

  let base: string | undefined;
  let ours: string | undefined;
  let theirs: string | undefined;

  if (repo) {
    oursLabel = repo.state.HEAD?.name
      ? `Your version (${repo.state.HEAD.name})`
      : "Your version";
    // Stage refs are `:1`/`:2`/`:3` (NO trailing colon): vscode.git's show()
    // builds the object as `${ref}:${path}`, so `:2:` would become `:2::path`
    // and every read would throw — silently dropping us to the marker fallback.
    [base, ours, theirs] = await Promise.all([
      showStage(repo, ":1", fileName),
      showStage(repo, ":2", fileName),
      showStage(repo, ":3", fileName),
    ]);
    if (ours !== undefined || theirs !== undefined) {
      source = "git-stages";
    }
  }

  // Fallback: reconstruct from markers in the working-tree text.
  if (source === "none") {
    const parsed = parseConflictMarkers(documentText);
    if (parsed.hasConflicts) {
      source = "markers";
      ours = parsed.ours;
      theirs = parsed.theirs;
      base = parsed.isDiff3 ? parsed.base : undefined;
    }
  }

  const conflictType = classifyConflict(base, ours, theirs);
  const hasBase = base !== undefined;

  return {
    fileName,
    conflictType,
    source,
    hasBase,
    oursLabel,
    theirsLabel,
    base: base ?? "",
    ours: ours ?? "",
    theirs: theirs ?? "",
    result: documentText,
  };
}

export interface HeadVersion {
  /** The file's content at HEAD. */
  text: string;
  /** Short branch/HEAD name for labelling, when available. */
  ref: string;
}

/**
 * Reads a file's content at git HEAD (for "working tree vs HEAD" diffs).
 * Returns undefined when there's no repo or the file is untracked at HEAD.
 */
export async function getHeadVersion(
  uri: vscode.Uri,
): Promise<HeadVersion | undefined> {
  const api = await getGitApi();
  const repo = api?.getRepository(uri);
  if (!repo) {
    return undefined;
  }
  try {
    const text = await repo.show("HEAD", uri.fsPath);
    const ref = repo.state.HEAD?.name ?? "HEAD";
    return { text, ref };
  } catch {
    return undefined;
  }
}

/** Whether the file is currently an unresolved merge conflict in git. */
export async function isConflicted(uri: vscode.Uri): Promise<boolean> {
  const api = await getGitApi();
  const repo = api?.getRepository(uri);
  if (!repo) {
    return false;
  }
  const target = uri.toString();
  return repo.state.mergeChanges.some(
    (change) => change.uri.toString() === target,
  );
}

/** Stages a fully-resolved file (the canonical "mark resolved"). */
export async function markResolved(uri: vscode.Uri): Promise<boolean> {
  const api = await getGitApi();
  const repo = api?.getRepository(uri);
  if (!repo) {
    return false;
  }
  await repo.add([uri.fsPath]);
  return true;
}

export type { Repository } from "./git";

/** Root fsPath of the repository containing the file, if any. */
export async function getRepoRoot(uri: vscode.Uri): Promise<string | undefined> {
  const api = await getGitApi();
  return api?.getRepository(uri)?.rootUri.fsPath;
}

/** The first open repository with unresolved merge conflicts, if any. */
export async function findRepoWithConflicts(): Promise<Repository | undefined> {
  const api = await getGitApi();
  return (
    api?.repositories.find((repo) => repo.state.mergeChanges.length > 0) ??
    undefined
  );
}

/**
 * Wires a listener to state changes of every current and future repository
 * (also invoked once per repository on hook-up, so startup state is seen).
 */
export function watchRepositories(
  context: vscode.ExtensionContext,
  listener: (repo: Repository) => void,
): void {
  void (async () => {
    const api = await getGitApi();
    if (!api) {
      return;
    }
    const hook = (repo: Repository) => {
      context.subscriptions.push(repo.state.onDidChange(() => listener(repo)));
      listener(repo);
    };
    api.repositories.forEach(hook);
    context.subscriptions.push(api.onDidOpenRepository(hook));
  })();
}
