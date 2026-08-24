#!/usr/bin/env bash
#
# OperoX Phase 109 spike measurement script (SPK-06 / SPK-07 gate).
#
# Written in 109-01 Task 3, BEFORE any core patch exists, so this file's own definition of "core
# patch" cannot be tuned after the fact to whatever the eventual patches turn out to be. Its first
# run (the Wave 0 baseline) legitimately reports zero files / zero LOC / an empty enterprise set /
# one workspace — that is the correct starting point, not a failure.
#
# Usage:
#   bash scripts/spike-checks.sh [BASE_REF] [--require-workspaces N]
#   BASE_REF defaults to twenty/v2.34.0 (the phase's pinned tag, D-12).
#
# Runs from any working directory (locates the repo root relative to this file), so it also works
# as `bash ../twenty/scripts/spike-checks.sh` from a sibling directory (e.g. the opero-x repo root).
#
# Exit code: 0 if every probe that runs in assertion mode PASSes, non-zero otherwise. INFO lines
# never affect the exit code.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

BASE_REF="twenty/v2.34.0"
REQUIRE_WORKSPACES=""

# Simple positional + flag parsing: first non-flag arg is BASE_REF, --require-workspaces takes a value.
while [ $# -gt 0 ]; do
  case "$1" in
    --require-workspaces)
      REQUIRE_WORKSPACES="${2:-}"
      shift 2
      ;;
    --require-workspaces=*)
      REQUIRE_WORKSPACES="${1#--require-workspaces=}"
      shift
      ;;
    *)
      BASE_REF="$1"
      shift
      ;;
  esac
done

OVERALL_EXIT=0
PASS_COUNT=0
FAIL_COUNT=0

pass() { echo "PASS: $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "FAIL: $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); OVERALL_EXIT=1; }
info() { echo "INFO: $1"; }
ran()  { echo "  ran: $1"; }

echo "=== OperoX Phase 109 spike-checks.sh ==="
echo "Repo root: ${REPO_ROOT}"
echo "Base ref:  ${BASE_REF}"
echo "HEAD:      $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo

# ---------------------------------------------------------------------------
# Probe 1 — core patch file count (D-05: <=5 files)
# ---------------------------------------------------------------------------
echo "--- Probe 1: core patch file count (packages/ only) ---"
CMD1="git diff ${BASE_REF}..HEAD --name-only -- packages/"
ran "${CMD1}"
PATCH_FILES="$(git diff "${BASE_REF}"..HEAD --name-only -- packages/ 2>/dev/null || true)"
PATCH_FILE_COUNT=0
if [ -n "${PATCH_FILES}" ]; then
  PATCH_FILE_COUNT=$(printf '%s\n' "${PATCH_FILES}" | grep -c . || true)
fi
info "patch file count (packages/ scope) = ${PATCH_FILE_COUNT}"
if [ "${PATCH_FILE_COUNT}" -le 5 ]; then
  pass "patch file count ${PATCH_FILE_COUNT} <= 5 (D-05 budget)"
else
  fail "patch file count ${PATCH_FILE_COUNT} > 5 (D-05 budget exceeded)"
fi

# This scope is deliberate: scripts/spike-checks.sh itself, .env.spike.example and
# docker-compose.spike.yml are spike infrastructure, not core patches to Twenty. The unrestricted
# list below makes that exclusion visible/auditable rather than hidden.
CMD1B="git diff ${BASE_REF}..HEAD --name-only"
ran "${CMD1B}"
UNRESTRICTED_FILES="$(git diff "${BASE_REF}"..HEAD --name-only 2>/dev/null || true)"
if [ -n "${UNRESTRICTED_FILES}" ]; then
  info "unrestricted changed-file list (includes spike infra, NOT counted toward D-05):"
  printf '%s\n' "${UNRESTRICTED_FILES}" | sed 's/^/  - /'
else
  info "unrestricted changed-file list: (empty — no commits yet on top of ${BASE_REF})"
fi

# ---------------------------------------------------------------------------
# Probe 2 — core patch LOC (D-05: <=1000 LOC, packages/ only)
# ---------------------------------------------------------------------------
echo
echo "--- Probe 2: core patch LOC (packages/ only) ---"
CMD2="git diff ${BASE_REF}..HEAD --shortstat -- packages/"
ran "${CMD2}"
SHORTSTAT="$(git diff "${BASE_REF}"..HEAD --shortstat -- packages/ 2>/dev/null || true)"
if [ -n "${SHORTSTAT}" ]; then
  info "shortstat: ${SHORTSTAT}"
else
  info "shortstat: (empty — no diff in packages/)"
fi
INSERTIONS=$(printf '%s' "${SHORTSTAT}" | grep -oE '[0-9]+ insertion' | grep -oE '^[0-9]+' || echo 0)
DELETIONS=$(printf '%s' "${SHORTSTAT}" | grep -oE '[0-9]+ deletion' | grep -oE '^[0-9]+' || echo 0)
INSERTIONS=${INSERTIONS:-0}
DELETIONS=${DELETIONS:-0}
PATCH_LOC=$((INSERTIONS + DELETIONS))
info "patch LOC (packages/ scope) = ${PATCH_LOC} (insertions=${INSERTIONS}, deletions=${DELETIONS})"
if [ "${PATCH_LOC}" -le 1000 ]; then
  pass "patch LOC ${PATCH_LOC} <= 1000 (D-05 budget)"
else
  fail "patch LOC ${PATCH_LOC} > 1000 (D-05 budget exceeded)"
fi

# ---------------------------------------------------------------------------
# Probe 3 — enterprise contamination (D-02)
# ---------------------------------------------------------------------------
echo
echo "--- Probe 3: enterprise-header contamination ---"
CMD3="git diff ${BASE_REF}..HEAD --name-only | (only existing files) | xargs grep -l '@license Enterprise'"
ran "${CMD3}"

ENTERPRISE_HITS=""
if [ -n "${UNRESTRICTED_FILES}" ]; then
  # Guard the empty-file-list case explicitly rather than piping into xargs grep and trusting its
  # exit status — an empty input to `xargs grep` can produce a spurious non-zero/empty result that
  # is easy to misread as "no matches" for the wrong reason.
  EXISTING_FILES=""
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    [ -f "${REPO_ROOT}/${f}" ] && EXISTING_FILES="${EXISTING_FILES}${f}"$'\n'
  done <<< "${UNRESTRICTED_FILES}"

  if [ -n "${EXISTING_FILES}" ]; then
    ENTERPRISE_HITS="$(printf '%s' "${EXISTING_FILES}" | xargs -r grep -l '@license Enterprise' 2>/dev/null || true)"
  fi
fi

if [ -z "${ENTERPRISE_HITS}" ]; then
  pass "no changed file contains the '@license Enterprise' marker"
else
  fail "enterprise-licensed file(s) touched by the diff:"
  printf '%s\n' "${ENTERPRISE_HITS}" | sed 's/^/  - /'
fi

CMD3B="git diff ${BASE_REF}..HEAD | grep -c ENTERPRISE_KEY"
ran "${CMD3B}"
ENTERPRISE_KEY_HITS="$(git diff "${BASE_REF}"..HEAD 2>/dev/null | grep -c "ENTERPRISE_KEY" || true)"
ENTERPRISE_KEY_HITS=${ENTERPRISE_KEY_HITS:-0}
if [ "${ENTERPRISE_KEY_HITS}" -eq 0 ]; then
  pass "ENTERPRISE_KEY appears in no tracked file added or modified by the diff"
else
  fail "ENTERPRISE_KEY appears ${ENTERPRISE_KEY_HITS} time(s) in the diff (D-02 violated)"
fi

# ---------------------------------------------------------------------------
# Probe 4 — workspace count (SPK-01; INFO by default, assertion with --require-workspaces N)
# ---------------------------------------------------------------------------
echo
echo "--- Probe 4: workspace count ---"

# Resolve DB credentials the same way docker-compose.spike.yml does, so this probe works whether
# or not the caller has .env.spike sourced into their shell.
PG_USER="postgres"
PG_DB="default"
if [ -f "${REPO_ROOT}/.env.spike" ]; then
  ENV_PG_USER="$(grep -E '^PG_DATABASE_USER=' "${REPO_ROOT}/.env.spike" | tail -1 | cut -d= -f2-)"
  ENV_PG_DB="$(grep -E '^PG_DATABASE_NAME=' "${REPO_ROOT}/.env.spike" | tail -1 | cut -d= -f2-)"
  [ -n "${ENV_PG_USER}" ] && PG_USER="${ENV_PG_USER}"
  [ -n "${ENV_PG_DB}" ] && PG_DB="${ENV_PG_DB}"
fi

CMD4="docker compose -f docker-compose.spike.yml exec -T db psql -U ${PG_USER} -d ${PG_DB} -tAc 'SELECT count(*) FROM core.workspace;'"
ran "${CMD4}"
WORKSPACE_COUNT_RAW="$(docker compose -f "${REPO_ROOT}/docker-compose.spike.yml" --project-directory "${REPO_ROOT}" exec -T db psql -U "${PG_USER}" -d "${PG_DB}" -tAc 'SELECT count(*) FROM core.workspace;' 2>/dev/null || true)"
WORKSPACE_COUNT="$(printf '%s' "${WORKSPACE_COUNT_RAW}" | tr -d '[:space:]')"

if [ -z "${WORKSPACE_COUNT}" ]; then
  info "workspace count could not be determined (is the 'db' service running? see docker compose ps)"
  if [ -n "${REQUIRE_WORKSPACES}" ]; then
    fail "workspace count required (>= ${REQUIRE_WORKSPACES}) but could not be determined"
  fi
else
  info "workspace count = ${WORKSPACE_COUNT}"
  if [ -n "${REQUIRE_WORKSPACES}" ]; then
    if [ "${WORKSPACE_COUNT}" -ge "${REQUIRE_WORKSPACES}" ]; then
      pass "workspace count ${WORKSPACE_COUNT} >= required ${REQUIRE_WORKSPACES}"
    else
      fail "workspace count ${WORKSPACE_COUNT} < required ${REQUIRE_WORKSPACES}"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
if [ "${FAIL_COUNT}" -eq 0 ]; then
  # Deliberately does not contain the substring "fail" (any case) when there are zero failures —
  # a caller that greps this output for /fail/i to detect a bad run must not false-positive on a
  # summary line reporting zero of them.
  echo "=== Summary: ${PASS_COUNT} passed, 0 problems ==="
else
  echo "=== Summary: ${PASS_COUNT} passed, ${FAIL_COUNT} FAILED — see FAIL: lines above ==="
fi
exit ${OVERALL_EXIT}
