#!/usr/bin/env bash
# Creates a throwaway git repo with a COMPLICATED merge conflict for stress-
# testing the merge editor. userService.js exercises every block kind:
#   - multi-line conflicts with unequal heights (header, fetchUser)
#   - delete-vs-modify conflict (legacyTransform)
#   - overlapping insertion-vs-rename conflict (cache declaration)
#   - one-line value conflicts (RETRY_LIMIT, config version)
#   - identical both-side edit -> "both-same", enables the magic wand (isAdmin)
#   - left-only / right-only insertions and modifications scattered around
#   - a conflict at end-of-file (export list)
# config.json adds a second conflicted file for the SCM multi-file flow.
#
# Usage:  ./make-stress-conflict.sh [target-dir]
# Prints the repo path on the last line.
set -euo pipefail

DIR="${1:-$(mktemp -d -t jbmerge-stress)}"
mkdir -p "$DIR"
cd "$DIR"

git init -q -b master
git config user.email "test@example.com"
git config user.name "Test"
git config commit.gpgsign false
git config merge.conflictStyle diff3

# ---------------------------------------------------------------- base ----
cat > userService.js <<'EOF'
/**
 * User service module.
 * Handles fetching, caching, and formatting of user records.
 */

const RETRY_LIMIT = 3;
const CACHE_TTL = 600;
const API_ROOT = "/api/v1";

const cache = new Map();

function formatName(user) {
  return user.firstName + " " + user.lastName;
}

function validateEmail(email) {
  return email.includes("@");
}

function legacyTransform(record) {
  const copy = Object.assign({}, record);
  copy.legacy = true;
  return copy;
}

async function fetchUser(id) {
  const cached = cache.get(id);
  if (cached) {
    return cached;
  }
  const response = await fetch(`${API_ROOT}/users/${id}`);
  const user = await response.json();
  cache.set(id, user);
  return user;
}

async function updateUser(id, patch) {
  const response = await fetch(`${API_ROOT}/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
  return response.json();
}

function isAdmin(user) {
  return user.role === "admin";
}

function clearCache() {
  cache.clear();
}

export { fetchUser, updateUser, clearCache };
EOF

cat > config.json <<'EOF'
{
  "name": "demo-app",
  "version": "1.0.0",
  "api": {
    "root": "/api/v1",
    "timeoutMs": 5000
  },
  "features": {
    "newDashboard": false,
    "betaSearch": false
  }
}
EOF

git add .
git commit -qm "base"

# ------------------------------------------------------------- feature ----
git checkout -q -b feature
cat > userService.js <<'EOF'
/**
 * User service module (v2 API surface).
 * Fetches, caches, validates, and formats user records.
 * @since 2.0
 * @author feature-team
 */

const RETRY_LIMIT = 10;
const CACHE_TTL = 900;
const API_ROOT = "/api/v1";

const userCache = new Map();

function formatName(user) {
  return user.firstName + " " + user.lastName;
}

function sanitizeInput(value) {
  return String(value).replace(/[<>]/g, "").trim();
}

function validateEmail(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

function legacyTransform(record) {
  const copy = Object.assign({}, record);
  copy.legacy = true;
  copy.migratedAt = Date.now();
  return copy;
}

async function fetchUser(id) {
  const cached = userCache.get(id);
  if (cached) {
    return cached;
  }
  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
    try {
      const response = await fetch(`${API_ROOT}/users/${id}`);
      const user = await response.json();
      userCache.set(id, user);
      return user;
    } catch (error) {
      if (attempt === RETRY_LIMIT) {
        throw error;
      }
    }
  }
}

async function updateUser(id, patch) {
  const response = await fetch(`${API_ROOT}/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return response.json();
}

function isAdmin(user) {
  return user.role === "admin" || user.role === "owner";
}

function clearCache() {
  userCache.clear();
}

export { fetchUser, updateUser, clearCache, validateEmail, sanitizeInput };
EOF

cat > config.json <<'EOF'
{
  "name": "demo-app",
  "version": "2.0.0",
  "api": {
    "root": "/api/v1",
    "timeoutMs": 5000
  },
  "features": {
    "newDashboard": true,
    "betaSearch": false
  }
}
EOF

git commit -qam "feature: retries, validation, sanitizing, cache rename"

# -------------------------------------------------------------- master ----
git checkout -q master
cat > userService.js <<'EOF'
/**
 * User service module — maintained by the platform team.
 * Handles fetching, caching, and formatting of user records.
 * @owner platform-core
 */

const RETRY_LIMIT = 5;
const CACHE_TTL = 900;
const API_ROOT = "/api/v1";

const cache = new Map();

function buildCacheKey(id) {
  return `user:${id}`;
}

function formatName(user) {
  const first = (user.firstName ?? "").trim();
  const last = (user.lastName ?? "").trim();
  return `${first} ${last}`.trim();
}

function validateEmail(email) {
  return email.includes("@");
}

async function fetchUser(userId) {
  const cached = cache.get(buildCacheKey(userId));
  if (cached) {
    return cached;
  }
  console.debug("fetchUser", userId);
  const response = await fetch(`${API_ROOT}/users/${userId}`);
  const user = await response.json();
  cache.set(buildCacheKey(userId), user);
  return user;
}

async function updateUser(id, patch) {
  const response = await fetch(`${API_ROOT}/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
  return response.json();
}

function isAdmin(user) {
  return user.role === "admin" || user.role === "owner";
}

function clearCache() {
  cache.clear();
}

export { fetchUser, updateUser, clearCache, formatName, buildCacheKey };
EOF

cat > config.json <<'EOF'
{
  "name": "demo-app",
  "version": "1.1.0",
  "api": {
    "root": "/api/v1",
    "timeoutMs": 8000
  },
  "features": {
    "newDashboard": false,
    "betaSearch": false
  }
}
EOF

git commit -qam "master: platform header, cache keys, formatName cleanup, legacy removal"

# --------------------------------------------------------------- merge ----
set +e
git merge feature -m "merge feature" >/dev/null 2>&1
set -e

echo "$DIR"
