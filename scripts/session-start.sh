#!/bin/bash
# SessionStart hook — runs every time a session starts (new or resumed).
# Configured in .claude/settings.json under hooks.SessionStart.

# Only run in remote (cloud) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  echo "Local environment detected — skipping remote setup."
  exit 0
fi

echo "=== Session start (remote) ==="

# ── Auto-run setup.sh if it hasn't run yet ───────────────────────────────────
SETUP_MARKER="# === claude-code-setup ==="
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if ! grep -q "$SETUP_MARKER" /etc/environment 2>/dev/null; then
  echo "Setup marker not found — running setup.sh automatically..."
  if [ -x "${SCRIPT_DIR}/setup.sh" ] || [ -f "${SCRIPT_DIR}/setup.sh" ]; then
    bash "${SCRIPT_DIR}/setup.sh" 2>&1 || echo "Warning: setup.sh exited with $? (non-fatal)"
  else
    echo "Warning: setup.sh not found at ${SCRIPT_DIR}/setup.sh"
  fi
fi

# Source persisted env vars from setup.sh
set -a; source /etc/environment 2>/dev/null || true; set +a

# ── Detect toolchain paths ──────────────────────────────────────────────────


# ── Persist env vars for Claude's Bash tool ──────────────────────────────────
_persist() {
  local k="$1" v="$2"
  [ -n "${CLAUDE_ENV_FILE:-}" ] && echo "${k}=${v}" >> "$CLAUDE_ENV_FILE"
  export "${k}=${v}"
}


NEW_PATH=""
[ -n "$NEW_PATH" ] && _persist PATH "${NEW_PATH}:${PATH}"

# Fallback for when CLAUDE_ENV_FILE isn't available
if [ -z "${CLAUDE_ENV_FILE:-}" ]; then
  cat > /etc/profile.d/claude-code-env.sh <<'PROFILE'
PROFILE
fi


# ── Install project dependencies ────────────────────────────────────────────
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" 2>/dev/null || exit 0

# Node
if   [ -f package-lock.json ];  then npm install --prefer-offline 2>/dev/null || true
elif [ -f pnpm-lock.yaml ];     then pnpm install --frozen-lockfile 2>/dev/null || true
elif [ -f yarn.lock ];          then yarn install --frozen-lockfile 2>/dev/null || true
elif [ -f bun.lock ] || [ -f bun.lockb ]; then bun install --frozen-lockfile 2>/dev/null || true
fi


echo "=== Session ready ==="
exit 0
