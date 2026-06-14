#!/usr/bin/env bash
# Creates a throwaway git repo with a committed base file and a heavily-edited
# working tree, for exercising the PLAIN diff viewer (working tree vs HEAD) —
# not the 3-way merge editor. Open the repo, open the changed file's diff from
# the SCM panel, and you'll see a realistic mix of edits plus, optionally, a
# huge file for load-testing the diff renderer.
#
# Working-tree changes are a cycled mix:
#   kind 0  modify a line
#   kind 1  delete the block
#   kind 2  insert lines after the block
#   kind 3  leave unchanged (context)
#   kind 4  rewrite the whole block
# Plus: a big deletion in the middle and a big append at the end.
#
# Usage:  ./make-load-diff.sh [blocks] [target-dir]
#   blocks defaults to 1500  (-> ~9k-line file). Try 6000 to stress it.
# Prints the repo path on the last line.
set -euo pipefail

N="${1:-1500}"
DIR="${2:-$(mktemp -d -t jbmerge-diff)}"
mkdir -p "$DIR"
cd "$DIR"

git init -q -b master
git config user.email "test@example.com"
git config user.name "Test"
git config commit.gpgsign false

# ---- base file generator -----------------------------------------------------
gen_base() {
  local n="$1" i
  printf '/**\n * Generated module for diff-viewer load testing.\n * %d blocks.\n */\n\n' "$n"
  for ((i = 0; i < n; i++)); do
    printf '// ---- block %05d ----\n' "$i"
    printf 'function fn%05d(x) {\n' "$i"
    printf '  const limit = %d;\n' "$i"
    printf '  const label = "block-%05d";\n' "$i"
    printf '  return transform(x, limit, label);\n'
    printf '}\n\n'
  done
  printf 'export const TOTAL = %d;\n' "$n"
}

# ---- working-tree variant ----------------------------------------------------
# Same structure, with cycled edits. Reads block index to decide the change.
gen_edited() {
  local n="$1" i kind j
  printf '/**\n * Generated module for diff-viewer load testing.\n * %d blocks — EDITED working tree.\n */\n\n' "$n"
  for ((i = 0; i < n; i++)); do
    kind=$((i % 5))
    # kind 1 in the first third => big contiguous deletion region
    if [ "$kind" -eq 1 ] && [ "$i" -lt $((n / 3)) ]; then
      continue   # drop the block entirely
    fi
    printf '// ---- block %05d ----\n' "$i"
    printf 'function fn%05d(x) {\n' "$i"
    case $kind in
      0) printf '  const limit = %d;\n' $((i + 1000000)) ;;   # modified value
      4)                                                       # full rewrite
        printf '  const ceiling = %d;\n' $((i * 2))
        printf '  const tag = `rewritten-%05d`;\n' "$i"
        printf '  precheck(x);\n'
        printf '  return rebuild(x, ceiling, tag);\n'
        printf '}\n\n'
        continue ;;
      *) printf '  const limit = %d;\n' "$i" ;;               # unchanged
    esac
    printf '  const label = "block-%05d";\n' "$i"
    printf '  return transform(x, limit, label);\n'
    printf '}\n\n'
    if [ "$kind" -eq 2 ]; then                                # inserted lines
      printf '// inserted note for block %05d\n' "$i"
      for j in 1 2 3; do printf 'const extra_%05d_%d = %d;\n' "$i" "$j" $((i * 10 + j)); done
      printf '\n'
    fi
  done
  printf 'export const TOTAL = %d;\n' "$n"
  printf '\n// ===== appended tail block (large addition) =====\n'
  for ((i = 0; i < n / 4; i++)); do
    printf 'export const NEW_%05d = %d;\n' "$i" $((i + 1))
  done
}

# ---- commit base, then dirty the working tree -------------------------------
gen_base "$N" > module.js
# also drop a small normal file for the "typical" diff look
cat > README.md <<'EOF'
# Diff Load Test

This file has a couple of edits so the diff viewer has something small and
human-readable to show alongside the giant module.js.

- bullet one
- bullet two
- bullet three
EOF
git add .
git commit -qm "base"

# edit both files in the working tree (left unstaged)
gen_edited "$N" > module.js
cat > README.md <<'EOF'
# Diff Load Test (edited)

This file has a couple of edits so the diff viewer has something small and
human-readable to show alongside the giant module.js.

- bullet one (changed)
- bullet two
- a brand new bullet
- bullet three
- another new bullet
EOF

echo "$DIR"
