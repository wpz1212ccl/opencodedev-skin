#!/usr/bin/env bash
# Common functions for OpenCode Dream Skin (macOS)
set -euo pipefail

APP_NAME="OpenCode"

# ─── Find OpenCode installation ───────────────────────────────────────────────

find_opencode_install() {
  local candidates=()

  # Standard macOS .app bundle paths
  local search_paths=(
    "/Applications/OpenCode.app/Contents/MacOS/OpenCode"
    "$HOME/Applications/OpenCode.app/Contents/MacOS/OpenCode"
    "/Applications/opencode.app/Contents/MacOS/OpenCode"
    "$HOME/Applications/opencode.app/Contents/MacOS/OpenCode"
  )
  for p in "${search_paths[@]}"; do
    if [[ -x "$p" ]]; then
      candidates+=("$p")
    fi
  done

  # CLI installs (brew, cargo, npm, etc.)
  local cli_paths=(
    "/usr/local/bin/opencode"
    "/opt/homebrew/bin/opencode"
    "$HOME/.cargo/bin/opencode"
  )
  for p in "${cli_paths[@]}"; do
    if [[ -x "$p" ]]; then
      candidates+=("$p")
    fi
  done
  if command -v opencode &>/dev/null; then
    local resolved
    resolved="$(command -v opencode)"
    candidates+=("$resolved")
  fi

  # mdfind spotlight search for .app bundles
  local mdfind_results
  mdfind_results="$(mdfind "kMDItemKind == 'Application' && kMDItemDisplayName == 'OpenCode*'" 2>/dev/null || true)"
  if [[ -n "$mdfind_results" ]]; then
    while IFS= read -r app_path; do
      local bin_path="$app_path/Contents/MacOS/OpenCode"
      if [[ -x "$bin_path" ]]; then
        candidates+=("$bin_path")
      fi
    done <<< "$mdfind_results"
  fi

  # Running processes
  local proc_path
  proc_path="$(pgrep -fl "OpenCode" 2>/dev/null | head -1 | cut -d' ' -f2- || true)"
  if [[ -n "$proc_path" && -x "$proc_path" ]]; then
    candidates+=("$proc_path")
  fi

  # Deduplicate and print
  printf '%s\n' "${candidates[@]}" | sort -u | while IFS= read -r p; do
    [[ -n "$p" ]] && echo "$p"
  done
}

# ─── Start OpenCode with CDP ──────────────────────────────────────────────────

start_opencode_app() {
  local executable_path="$1"
  shift
  local arguments=("$@")

  if [[ ! -x "$executable_path" ]]; then
    echo "[ERROR] OpenCode executable not found: $executable_path" >&2
    return 1
  fi

  nohup "$executable_path" "${arguments[@]}" > /dev/null 2>&1 &
  local pid=$!
  echo "[INFO] OpenCode started (PID: $pid)" >&2
  echo "$pid"
}

# ─── Stop OpenCode ────────────────────────────────────────────────────────────

stop_opencode_app() {
  local executable_path="${1:-}"
  local timeout_sec="${2:-15}"
  local allow_force="${3:-true}"

  local pids
  if [[ -n "$executable_path" ]]; then
    pids="$(pgrep -f "$(basename "$executable_path")" 2>/dev/null || true)"
  else
    pids="$(pgrep -f "$APP_NAME" 2>/dev/null || true)"
  fi

  if [[ -z "$pids" ]]; then
    return 0
  fi

  # Graceful shutdown
  echo "$pids" | while read -r pid; do
    [[ -n "$pid" ]] && kill -TERM "$pid" 2>/dev/null || true
  done

  # Wait
  local deadline=$((SECONDS + timeout_sec))
  while [[ $SECONDS -lt $deadline ]]; do
    local still_running
    if [[ -n "$executable_path" ]]; then
      still_running="$(pgrep -f "$(basename "$executable_path")" 2>/dev/null || true)"
    else
      still_running="$(pgrep -f "$APP_NAME" 2>/dev/null || true)"
    fi
    if [[ -z "$still_running" ]]; then
      return 0
    fi
    sleep 0.5
  done

  # Force kill
  if [[ "$allow_force" == "true" ]]; then
    local remaining
    if [[ -n "$executable_path" ]]; then
      remaining="$(pgrep -f "$(basename "$executable_path")" 2>/dev/null || true)"
    else
      remaining="$(pgrep -f "$APP_NAME" 2>/dev/null || true)"
    fi
    echo "$remaining" | while read -r pid; do
      [[ -n "$pid" ]] && kill -KILL "$pid" 2>/dev/null || true
    done
  fi
}

# ─── Get running OpenCode processes ───────────────────────────────────────────

get_opencode_processes() {
  local executable_path="${1:-}"
  if [[ -n "$executable_path" ]]; then
    pgrep -fl "$(basename "$executable_path")" 2>/dev/null || true
  else
    pgrep -fl "$APP_NAME" 2>/dev/null || true
  fi
}

# ─── Check if port is owned by OpenCode ───────────────────────────────────────

test_opencode_port_owner() {
  local port="$1"
  local pid
  pid="$(lsof -ti :"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    return 1
  fi
  local proc_name
  proc_name="$(ps -p "$pid" -o comm= 2>/dev/null || true)"
  if echo "$proc_name" | grep -qi "$APP_NAME"; then
    return 0
  fi
  return 1
}

# ─── Wait for CDP to be ready ────────────────────────────────────────────────

wait_opencode_ready() {
  local port="${1:-9335}"
  local timeout_sec="${2:-30}"
  local retry_interval="${3:-0.5}"

  local deadline=$((SECONDS + timeout_sec))
  while [[ $SECONDS -lt $deadline ]]; do
    if curl -s --max-time 2 "http://127.0.0.1:$port/json/version" > /dev/null 2>&1; then
      return 0
    fi
    sleep "$retry_interval"
  done
  return 1
}

# ─── Get OpenCode version ────────────────────────────────────────────────────

get_opencode_version() {
  local bundle_path="${1:-/Applications/OpenCode.app}"

  if [[ -f "$bundle_path/Contents/Info.plist" ]]; then
    /usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$bundle_path/Contents/Info.plist" 2>/dev/null || true
  elif [[ -x "$1" ]]; then
    "$1" --version 2>/dev/null || true
  fi
}
