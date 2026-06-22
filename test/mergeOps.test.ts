import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  abortOperation,
  acceptSide,
  conflictBadges,
  describeIncoming,
  detectOperation,
  parseUnmergedBadges,
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

test("parseUnmergedBadges maps porcelain-v2 XY codes (version-independent)", () => {
  // A real `git status --porcelain=v2 -z` body (NUL-separated). The leading
  // `1`/`2` records (ordinary/renamed changes) must be ignored. The key
  // regression: a both-modified file (UU) must map to "" — NOT "deleted by
  // both", which the old hardcoded vscode.git Status-enum map produced on
  // editors whose enum predated TYPE_CHANGED.
  const rec = (s: string) => s + "\0";
  const porcelain =
    rec("1 .M N... 100644 100644 100644 aaa bbb clean.txt") +
    rec("u UU N... 100644 100644 100644 100644 h1 h2 h3 src/both modified.py") +
    rec("u AA N... 000000 100644 100644 100644 0000 h2 h3 added.py") +
    rec("u DD N... 100644 000000 000000 000000 h1 0000 0000 gone.py") +
    rec("u UD N... 100644 100644 000000 100644 h1 h2 0000 ours-kept.py") +
    rec("u DU N... 100644 000000 100644 100644 h1 0000 h3 theirs-kept.py");

  const badges = parseUnmergedBadges(porcelain);
  assert.equal(badges.get("clean.txt"), undefined); // not unmerged
  assert.equal(badges.get("src/both modified.py"), ""); // path-with-space + UU
  assert.equal(badges.get("added.py"), "added by both");
  assert.equal(badges.get("gone.py"), "deleted by both");
  assert.equal(badges.get("ours-kept.py"), "deleted by them");
  assert.equal(badges.get("theirs-kept.py"), "deleted by us");
});

test("conflictBadges: a normal both-modified conflict gets NO badge", async () => {
  // The reported bug: a.txt/b.txt are plain both-modified conflicts that used
  // to render "(deleted on both)".
  const root = makeConflictedRepo();
  try {
    const badges = await conflictBadges(root);
    assert.equal(badges.get("a.txt"), "");
    assert.equal(badges.get("b.txt"), "");
  } finally {
    cleanup(root);
  }
});

test("conflictBadges: add/add is 'added by both'", async () => {
  const root = makeConflictedRepo();
  try {
    git(root, "merge", "--abort");
    git(root, "checkout", "-b", "adder");
    write(root, "new.txt", "from adder\n");
    git(root, "add", "new.txt");
    git(root, "commit", "-m", "adder adds new.txt");
    git(root, "checkout", "main");
    write(root, "new.txt", "from main\n");
    git(root, "add", "new.txt");
    git(root, "commit", "-m", "main adds new.txt");
    try {
      git(root, "merge", "adder");
      assert.fail("merge unexpectedly succeeded — fixture must conflict");
    } catch {
      // add/add conflict expected
    }
    const badges = await conflictBadges(root);
    assert.equal(badges.get("new.txt"), "added by both");
  } finally {
    cleanup(root);
  }
});
