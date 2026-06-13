import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  abortOperation,
  acceptSide,
  describeIncoming,
  detectOperation,
  restoreConflict,
} from "../src/git/mergeOps";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function write(root: string, name: string, content: string): void {
  fs.writeFileSync(path.join(root, name), content);
}

function read(root: string, name: string): string {
  return fs.readFileSync(path.join(root, name), "utf8");
}

/** A repo with `main` and `feature` both editing a.txt and b.txt, mid-merge. */
function makeConflictedRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jbmerge-gittest-"));
  git(root, "init");
  git(root, "checkout", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "test");
  write(root, "a.txt", "base\n");
  write(root, "b.txt", "base\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "base");
  git(root, "checkout", "-b", "feature");
  write(root, "a.txt", "feature\n");
  write(root, "b.txt", "feature\n");
  git(root, "commit", "-am", "feature change");
  git(root, "checkout", "main");
  write(root, "a.txt", "main\n");
  write(root, "b.txt", "main\n");
  git(root, "commit", "-am", "main change");
  try {
    git(root, "merge", "feature");
    assert.fail("merge unexpectedly succeeded — fixture must conflict");
  } catch {
    // conflict expected
  }
  return root;
}

function cleanup(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

test("detectOperation reports an in-progress merge, and nothing when clean", async () => {
  const root = makeConflictedRepo();
  try {
    assert.equal(await detectOperation(root), "merge");
    git(root, "merge", "--abort");
    assert.equal(await detectOperation(root), undefined);
  } finally {
    cleanup(root);
  }
});

test("acceptSide resolves to ours/theirs and stages the file", async () => {
  const root = makeConflictedRepo();
  try {
    await acceptSide(root, path.join(root, "a.txt"), "ours");
    assert.equal(read(root, "a.txt"), "main\n");
    await acceptSide(root, path.join(root, "b.txt"), "theirs");
    assert.equal(read(root, "b.txt"), "feature\n");
    assert.equal(git(root, "ls-files", "-u").trim(), ""); // nothing unmerged
  } finally {
    cleanup(root);
  }
});

test("acceptSide accepts a deletion when the chosen side deleted the file", async () => {
  const root = makeConflictedRepo();
  try {
    git(root, "merge", "--abort");

    // Modify/delete conflict on c.txt: main edits it, deleter removes it.
    write(root, "c.txt", "base\n");
    git(root, "add", "c.txt");
    git(root, "commit", "-m", "add c");
    git(root, "checkout", "-b", "deleter");
    git(root, "rm", "c.txt");
    git(root, "commit", "-m", "delete c");
    git(root, "checkout", "main");
    write(root, "c.txt", "main edit\n");
    git(root, "commit", "-am", "edit c");
    try {
      git(root, "merge", "deleter");
      assert.fail("merge unexpectedly succeeded — fixture must conflict");
    } catch {
      // modify/delete conflict expected
    }

    await acceptSide(root, path.join(root, "c.txt"), "theirs");
    assert.equal(fs.existsSync(path.join(root, "c.txt")), false);
    assert.equal(git(root, "ls-files", "-u").trim(), "");
  } finally {
    cleanup(root);
  }
});

test("restoreConflict re-creates a conflict that was resolved and staged", async () => {
  const root = makeConflictedRepo();
  try {
    await acceptSide(root, path.join(root, "a.txt"), "ours");
    assert.equal(git(root, "ls-files", "-u", "--", "a.txt").trim(), "");
    await restoreConflict(root, path.join(root, "a.txt"));
    // stages are back
    assert.notEqual(git(root, "ls-files", "-u", "--", "a.txt").trim(), "");
    assert.match(read(root, "a.txt"), /^<{7}/m); // markers restored
  } finally {
    cleanup(root);
  }
});

test("restoreConflict round-trips with a different second choice", async () => {
  const root = makeConflictedRepo();
  try {
    await acceptSide(root, path.join(root, "a.txt"), "ours");
    assert.equal(read(root, "a.txt"), "main\n");
    await restoreConflict(root, path.join(root, "a.txt"));
    await acceptSide(root, path.join(root, "a.txt"), "theirs");
    assert.equal(read(root, "a.txt"), "feature\n");
    assert.equal(git(root, "ls-files", "-u", "--", "a.txt").trim(), "");
  } finally {
    cleanup(root);
  }
});

test("abortOperation restores the pre-merge state", async () => {
  const root = makeConflictedRepo();
  try {
    // Simulate a partial manual resolution before cancelling.
    write(root, "a.txt", "half merged garbage\n");
    assert.equal(await abortOperation(root), "merge");
    assert.equal(await detectOperation(root), undefined);
    assert.equal(read(root, "a.txt"), "main\n");
    assert.equal(read(root, "b.txt"), "main\n");
    assert.equal(git(root, "status", "--porcelain").trim(), "");
  } finally {
    cleanup(root);
  }
});

test("detectOperation distinguishes rebase and cherry-pick from merge", async () => {
  const root = makeConflictedRepo();
  try {
    git(root, "merge", "--abort");

    // Conflicted cherry-pick: pick feature's a.txt change onto main.
    try {
      git(root, "cherry-pick", "feature");
      assert.fail("cherry-pick unexpectedly succeeded");
    } catch {
      // conflict expected
    }
    assert.equal(await detectOperation(root), "cherry-pick");
    git(root, "cherry-pick", "--abort");

    // Conflicted rebase: rebase feature onto main.
    git(root, "checkout", "feature");
    try {
      git(root, "rebase", "main");
      assert.fail("rebase unexpectedly succeeded");
    } catch {
      // conflict expected
    }
    assert.equal(await detectOperation(root), "rebase");
    git(root, "rebase", "--abort");
    assert.equal(await detectOperation(root), undefined);
  } finally {
    cleanup(root);
  }
});

test("abortOperation falls back to reset --merge for stash-pop conflicts", async () => {
  const root = makeConflictedRepo();
  try {
    git(root, "merge", "--abort");

    // Conflicted stash pop: stash an edit, make a conflicting commit, pop.
    write(root, "a.txt", "stashed edit\n");
    git(root, "stash");
    write(root, "a.txt", "committed edit\n");
    git(root, "commit", "-am", "conflicting commit");
    try {
      git(root, "stash", "pop");
      assert.fail("stash pop unexpectedly succeeded");
    } catch {
      // conflict expected
    }
    assert.notEqual(git(root, "ls-files", "-u").trim(), ""); // conflicted
    assert.equal(await detectOperation(root), undefined); // but no op file

    assert.equal(await abortOperation(root), "reset");
    assert.equal(git(root, "ls-files", "-u").trim(), ""); // conflict unwound
    assert.equal(read(root, "a.txt"), "committed edit\n");
  } finally {
    cleanup(root);
  }
});

// MERGE_MSG parsing: the dialog's "theirs" pill. describeIncoming reads
// .git/MERGE_MSG, so the variants can be written directly.
function writeMergeMsg(root: string, firstLine: string): void {
  const gitDir = git(root, "rev-parse", "--git-dir").trim();
  const resolved = path.isAbsolute(gitDir) ? gitDir : path.join(root, gitDir);
  fs.writeFileSync(path.join(resolved, "MERGE_MSG"), firstLine + "\n");
}

test("describeIncoming parses MERGE_MSG variants", async () => {
  const root = makeConflictedRepo(); // mid-merge, MERGE_MSG exists
  try {
    assert.equal(await describeIncoming(root), "feature"); // the real one

    writeMergeMsg(root, "Merge remote-tracking branch 'origin/feature'");
    assert.equal(await describeIncoming(root), "origin/feature");

    // Octopus merges use the plural form (regression: the singular-only
    // regex used to miss these entirely).
    writeMergeMsg(root, "Merge branches 'b1' and 'b2'");
    assert.equal(await describeIncoming(root), "b1, b2");

    writeMergeMsg(root, "Merge tag 'v1.2.0'");
    assert.equal(await describeIncoming(root), "v1.2.0");

    // Custom -m messages carry no branch name — must NOT false-positive.
    writeMergeMsg(root, "custom message from -m");
    assert.equal(await describeIncoming(root), undefined);
  } finally {
    cleanup(root);
  }
});
