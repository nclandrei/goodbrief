#!/usr/bin/env bash
#
# Recover a Good Brief week locally using Claude Code as the LLM backend.
# One-command alternative to manually chaining LFS pull → pipeline → validate →
# (optional) publish. Underneath it just calls the same npm scripts — no new
# logic, no bypassed validation.
#
# Usage:
#   scripts/recover-week.sh --week 2026-W15
#   scripts/recover-week.sh --week 2026-W15 --auto-publish
#   scripts/recover-week.sh --week 2026-W15 --fallback gemini
#   scripts/recover-week.sh --week 2026-W15 --from score
#
# What it does:
#   1. Preflight: checks `claude` CLI, `git-lfs`, `claude auth status`
#   2. git lfs pull data/raw/<week>.json so prepare has real input
#   3. npm run pipeline:run-all -- --week <w> --llm claude-cli --skip-existing
#      (resumable: re-run and it skips completed phases)
#   4. npm run validate-draft -- --week <w> --llm claude-cli
#   5. (only with --auto-publish) publish-issue + notify-draft
#
# Never auto-commits, never git push, never sends the newsletter.
# You still review the draft + proof email before Monday's send.

set -euo pipefail

WEEK=""
AUTO_PUBLISH=0
FALLBACK=""
FROM_PHASE=""

print_usage() {
  # Print every leading comment line (stopping at the first non-# line).
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --week)
      WEEK="${2:-}"
      shift 2
      ;;
    --auto-publish)
      AUTO_PUBLISH=1
      shift
      ;;
    --fallback)
      FALLBACK="${2:-}"
      shift 2
      ;;
    --from)
      FROM_PHASE="${2:-}"
      shift 2
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Unknown flag: $1" >&2
      print_usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$WEEK" ]]; then
  echo "Error: --week is required (e.g. --week 2026-W15)" >&2
  exit 1
fi

if ! [[ "$WEEK" =~ ^[0-9]{4}-W[0-9]{2}$ ]]; then
  echo "Error: --week must be YYYY-WXX format (got: $WEEK)" >&2
  exit 1
fi

# Always run from the repo root so relative paths resolve consistently.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" ]]; then
  echo "Error: must be run inside a git clone of goodbrief" >&2
  exit 1
fi
cd "$REPO_ROOT"

# --- terminal styling (no-op if stdout isn't a tty) ---
if [[ -t 1 ]]; then
  CYAN=$'\033[1;36m'; GREEN=$'\033[1;32m'; YELLOW=$'\033[1;33m'
  RED=$'\033[1;31m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
  CYAN=""; GREEN=""; YELLOW=""; RED=""; DIM=""; RESET=""
fi

step() { printf "\n%s▶ %s%s\n" "$CYAN" "$1" "$RESET"; }
ok()   { printf "%s✓ %s%s\n" "$GREEN" "$1" "$RESET"; }
warn() { printf "%s! %s%s\n" "$YELLOW" "$1" "$RESET"; }
fail() { printf "%s✗ %s%s\n" "$RED" "$1" "$RESET" >&2; exit 1; }

printf "\n%s=== Good Brief recovery: %s ===%s\n" "$CYAN" "$WEEK" "$RESET"
printf "%sLLM: claude-cli%s%s%s\n" "$DIM" \
  "${FALLBACK:+ (fallback=}" "${FALLBACK}" "${FALLBACK:+)}${RESET}"

# --- 1. Preflight ---
step "Preflight"

command -v claude  >/dev/null 2>&1 || \
  fail "'claude' CLI not found on PATH. Install Claude Code, then run 'claude login'."
command -v git-lfs >/dev/null 2>&1 || \
  fail "'git-lfs' not found. Install via: brew install git-lfs  OR  apt install git-lfs"

if ! claude auth status >/dev/null 2>&1; then
  warn "claude auth status reports not-logged-in. Run: claude login"
fi

if ! command -v npm >/dev/null 2>&1; then
  fail "'npm' not found"
fi

if [[ -n "$(git status --porcelain)" ]]; then
  warn "Working tree has uncommitted changes (continuing anyway)"
fi

ok "preflight ok"

# --- 2. Raw buffer ---
step "Pulling LFS buffer data/raw/$WEEK.json"

RAW_FILE="data/raw/$WEEK.json"
git lfs pull --include="$RAW_FILE" || fail "git lfs pull failed"

if [[ ! -f "$RAW_FILE" ]]; then
  fail "$RAW_FILE does not exist. Did the ingest-news workflow run for this week?"
fi

# Detect lingering LFS pointer (happens when the proxy blocks LFS traffic).
if head -c 64 "$RAW_FILE" | grep -q "git-lfs.github.com"; then
  fail "$RAW_FILE is still an LFS pointer. Check git-lfs config and auth."
fi

ok "raw buffer ready ($(wc -c < "$RAW_FILE" | tr -d ' ') bytes)"

# --- 3. Pipeline ---
step "pipeline:run-all (resumable via --skip-existing)"

PIPELINE_ARGS=(--week "$WEEK" --llm claude-cli --skip-existing)
[[ -n "$FALLBACK"   ]] && PIPELINE_ARGS+=(--fallback "$FALLBACK")
[[ -n "$FROM_PHASE" ]] && PIPELINE_ARGS+=(--from "$FROM_PHASE")

npm run --silent pipeline:run-all -- "${PIPELINE_ARGS[@]}"

DRAFT_FILE="data/drafts/$WEEK.json"
[[ -f "$DRAFT_FILE" ]] || fail "pipeline completed but $DRAFT_FILE was not created"
ok "draft at $DRAFT_FILE"

# --- 4. Validate ---
step "validate-draft"
npm run --silent validate-draft -- --week "$WEEK" --llm claude-cli
ok "validation updated"

# --- 5. Optional publish ---
if [[ "$AUTO_PUBLISH" -eq 1 ]]; then
  step "publish-issue"
  npm run --silent publish-issue -- --week "$WEEK"
  ok "issue markdown written to content/issues/"

  step "notify-draft (proof email)"
  npm run --silent notify-draft -- --week "$WEEK"
  ok "proof email sent"

  printf "\n%s=== Recovery complete for %s ===%s\n" "$GREEN" "$WEEK" "$RESET"
  printf "Review the proof email in your inbox. When you're happy:\n"
  printf "  %sgit add data/drafts/%s.json data/pipeline/%s content/issues%s\n" "$DIM" "$WEEK" "$WEEK" "$RESET"
  printf "  %sgit commit -m \"chore(%s): recover via Claude Code fallback\"%s\n" "$DIM" "$WEEK" "$RESET"
  printf "  %sgit push%s\n" "$DIM" "$RESET"
else
  printf "\n%s=== Draft ready for %s ===%s\n" "$GREEN" "$WEEK" "$RESET"
  printf "\nNext steps (re-run with --auto-publish to do these automatically):\n"
  printf "  %snpm run publish-issue -- --week %s%s\n" "$DIM" "$WEEK" "$RESET"
  printf "  %snpm run notify-draft  -- --week %s%s\n" "$DIM" "$WEEK" "$RESET"
  printf "\nThen commit:\n"
  printf "  %sgit add data/drafts/%s.json data/pipeline/%s content/issues%s\n" "$DIM" "$WEEK" "$WEEK" "$RESET"
  printf "  %sgit commit -m \"chore(%s): recover via Claude Code fallback\"%s\n" "$DIM" "$WEEK" "$RESET"
fi
