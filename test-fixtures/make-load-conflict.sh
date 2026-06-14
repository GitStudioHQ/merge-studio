#!/usr/bin/env bash
# Creates a throwaway git repo with HUGE conflicted files for load-testing the
# merge editor. Unlike make-stress-conflict.sh (which is hand-crafted to hit
# every block kind once), this one generates thousands of blocks across several
# files so you can stress rendering, scrolling, decoration count, and the
# accept-all / resolve flows under real volume.
#
# Block kinds are cycled so the file mixes every conflict variation:
#   kind 0  value conflict          (both sides change a line differently)
#   kind 1  unequal-height conflict (feature inserts lines + both edit a line)
#   kind 2  delete-vs-modify        (feature empties body, master edits it)
#   kind 3  both-same edit          (identical on both sides -> magic wand)
#   kind 4  feature-only change     (auto-merges, no conflict)
#   kind 5  master-only change      (auto-merges, no conflict)
#
# Files generated:
#   bigService.js  N blocks         (the main varied-conflict workhorse)
#   giantList.js   N*3 one-liners   (tall file, dense single-line conflicts)
#   config.json    small            (multi-file SCM flow)
#
# Usage:  ./make-load-conflict.sh [blocks] [target-dir]
#   blocks defaults to 1200  (-> bigService ~10k lines, giantList ~3600 lines)
#   try 4000+ to really hurt it.
# Prints the repo path on the last line.
set -euo pipefail

N="${1:-1200}"
DIR="${2:-$(mktemp -d -t jbmerge-load)}"
mkdir -p "$DIR"
cd "$DIR"

git init -q -b master
git config user.email "test@example.com"
git config user.name "Test"
git config commit.gpgsign false
git config merge.conflictStyle diff3

# ---- bigService.js generator -------------------------------------------------
# gen_service VARIANT N  -> stdout
gen_service() {
  local variant="$1" n="$2" i kind limit mode body extra
  printf '/**\n * Generated service surface (%s variant).\n * %d blocks, cycled across every conflict kind.\n */\n\n' "$variant" "$n"
  printf 'const API_ROOT = "/api/v1";\n\n'
  for ((i = 0; i < n; i++)); do
    kind=$((i % 6))
    limit=100; mode="base"; body=1; extra=""
    if [ "$variant" = feature ]; then
      case $kind in
        0) limit=200 ;;
        1) mode="feature"; extra=$'  validate(input);\n  log("feature path");\n  audit(input, id);\n' ;;
        2) body=0 ;;
        3) limit=999; mode="shared" ;;
        4) limit=444; mode="featureOnly" ;;
        5) : ;;
      esac
    elif [ "$variant" = master ]; then
      case $kind in
        0) limit=300 ;;
        1) mode="master" ;;
        2) limit=777; mode="masterEdit" ;;
        3) limit=999; mode="shared" ;;
        4) : ;;
        5) limit=555; mode="masterOnly" ;;
      esac
    fi
    printf '// ---- block %04d (kind=%d) ----\n' "$i" "$kind"
    printf 'function handler%04d(input, id) {\n' "$i"
    if [ "$body" -eq 1 ]; then
      printf '  const limit = %d;\n' "$limit"
      printf '  const mode = "%s";\n' "$mode"
      [ -n "$extra" ] && printf '%s' "$extra"
      printf '  let result = process(input, limit, mode);\n'
      printf '  return result;\n'
    fi
    printf '}\n\n'
  done
  printf 'export const BLOCK_COUNT = %d;\n' "$n"
}

# ---- giantList.js generator --------------------------------------------------
# A very tall file of single-line constants; ~half conflict.
gen_list() {
  local variant="$1" n="$2" i v
  printf '// Generated constant table (%s variant) — %d entries.\n' "$variant" "$n"
  printf 'export const TABLE = {\n'
  for ((i = 0; i < n; i++)); do
    v=$i
    if [ $((i % 2)) -eq 0 ]; then
      # even rows conflict: each side picks a different value
      [ "$variant" = feature ] && v=$((i + 100000))
      [ "$variant" = master ] && v=$((i + 200000))
    else
      # odd rows: only feature edits (auto-merge)
      [ "$variant" = feature ] && v=$((i + 500000))
    fi
    printf '  KEY_%05d: %d,\n' "$i" "$v"
  done
  printf '};\n'
}

# ---------------------------------------------------------------- base --------
gen_service base "$N" > bigService.js
gen_list base $((N * 3)) > giantList.js
cat > config.json <<'EOF'
{
  "name": "load-app",
  "version": "1.0.0",
  "features": { "newDashboard": false, "betaSearch": false }
}
EOF
git add .
git commit -qm "base"

# ------------------------------------------------------------- feature -------
git checkout -q -b feature
gen_service feature "$N" > bigService.js
gen_list feature $((N * 3)) > giantList.js
cat > config.json <<'EOF'
{
  "name": "load-app",
  "version": "2.0.0",
  "features": { "newDashboard": true, "betaSearch": false }
}
EOF
git commit -qam "feature variant"

# -------------------------------------------------------------- master -------
git checkout -q master
gen_service master "$N" > bigService.js
gen_list master $((N * 3)) > giantList.js
cat > config.json <<'EOF'
{
  "name": "load-app",
  "version": "3.0.0",
  "features": { "newDashboard": false, "betaSearch": true }
}
EOF
git commit -qam "master variant"

# ---- merge -> leaves conflicts in the working tree --------------------------
set +e
git merge feature -m "merge feature" >/dev/null 2>&1
set -e

echo "$DIR"
