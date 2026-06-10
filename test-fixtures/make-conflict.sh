#!/usr/bin/env bash
# Creates a throwaway git repo containing a real merge conflict, for manually
# testing the merge editor (open the repo, press F5, open the conflicted file).
#
# Usage:  ./make-conflict.sh [target-dir]
# Prints the repo path on the last line.
set -euo pipefail

DIR="${1:-$(mktemp -d -t jbmerge-conflict)}"
mkdir -p "$DIR"
cd "$DIR"

git init -q
git config user.email "test@example.com"
git config user.name "Test"
# diff3 style => working-tree markers include the ||||||| base section.
git config merge.conflictStyle diff3

FILE="app.js"

# --- base commit: lines 1 and 7 will be changed on BOTH sides (conflict),
#     line 4 only on one side (auto-mergeable). ---
cat > "$FILE" <<'EOF'
const greeting = "hello";
const unchangedA = 1;
const unchangedB = 2;
let counter = 0;
const unchangedC = 3;
const unchangedD = 4;
const footer = "base footer";
EOF
git add "$FILE"
git commit -qm "base"

# --- feature branch: conflicting edits on greeting + footer, plus a
#     non-conflicting edit to counter. ---
git checkout -q -b feature
cat > "$FILE" <<'EOF'
const greeting = "hi from feature";
const unchangedA = 1;
const unchangedB = 2;
let counter = 100;
const unchangedC = 3;
const unchangedD = 4;
const footer = "feature footer";
EOF
git commit -qam "feature changes"

# --- main: conflicting edits on greeting + footer (different from feature). ---
git checkout -q main 2>/dev/null || git checkout -q master
cat > "$FILE" <<'EOF'
const greeting = "hello from main";
const unchangedA = 1;
const unchangedB = 2;
let counter = 0;
const unchangedC = 3;
const unchangedD = 4;
const footer = "main footer";
EOF
git commit -qam "main changes"

# --- merge feature -> conflict (left in the working tree, unresolved). ---
set +e
git merge feature -m "merge feature" >/dev/null 2>&1
set -e

echo "$DIR"
