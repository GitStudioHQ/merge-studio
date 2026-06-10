import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  abortOperation,
  acceptSide,
  detectOperation,
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
