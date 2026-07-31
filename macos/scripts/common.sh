#!/usr/bin/env bash
# Common functions for OpenCode Dream Skin (macOS)
#
# Source this file in your scripts:
#   source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

APP_NAME="OpenCode"
DEFAULT_CDP_PORT=9335

# ─── Find OpenCode installation ───────────────────────────────────────────────
# Prints unique paths to OpenCode executables, one per line.
# Returns 0 if at least one was found, 1 otherwise.

find_opencode_install() {
  local candidates=()

  # 1. Standard .app bundle locations
  local p
  for p in \
    "/Applications/OpenCode.app/Contents/MacOS/OpenCode" \
    "$HOME/Applications/OpenCode.app/Contents/MacOS/OpenCode"
  do
    if [[ -x "$p" ]]; then
      candidates+=("$p")
    fi
  done

  # 2. mdfind (Spotlight) for bundles not in standard locations
  if command -v mdfind &>/dev/null; then
    local mdfind_results
    mdfind_results="$(mdfind "kMDItemKind == 'Application' && kMDItemDisplayName == 'OpenCode*'" 2>/dev/null || true)"
    if [[ -n "$mdfind_results" ]]; then
      while IFS= read -r app_path; do
        [[ -z "$app_path" ]] && continue
        local bin_path="$app_path/Contents/MacOS/OpenCode"
        if [[ -x "$bin_path" ]]; then
          candidates+=("$bin_path")
        fi
      done <<< "$mdfind_results"
    fi
  fi

  # 3. CLI installs (brew, cargo, npm, etc.)
  if command -v opencode &>/dev/null; then
    candidates+=("$(command -v opencode)")
  fi
  for p in \
    "/opt/homebrew/bin/opencode" \
    "/usr/local/bin/opencode" \
    "$HOME/.cargo/bin/opencode"
  do
    if [[ -x "$p" ]]; then
      candidates+=("$p")
    fi
  done

  # 4. Running process (may reveal unknown install locations)
  if command -v pgrep &>/dev/null; then
    local proc_line
    proc_line="$(pgrep -fl "$APP_NAME" 2>/dev/null | grep -v "pgrep" | head -1 || true)"
    if [[ -n "$proc_line" ]]; then
      local proc_path
      proc_path="$(echo "$proc_line" | cut -d' ' -f2-)"
      if [[ -x "$proc_path" ]]; then
        candidates+=("$proc_path")
      fi
    fi
  fi

  # Deduplicate and print
  if [[ ${#candidates[@]} -eq 0 ]]; then
    return 1
  fi
  printf '%s\n' "${candidates[@]}" | sort -u
  return 0
}

# ─── Start OpenCode with CDP ──────────────────────────────────────────────────
# Starts the OpenCode executable with given arguments in background.
# Prints the PID on success.

opencode_bundle_from_executable() {
  local executable_path="$1"
  local bundle_path
  bundle_path="$(echo "$executable_path" | sed 's|/Contents/MacOS/.*|.app|')"
  if [[ -d "$bundle_path" && -f "$bundle_path/Contents/Info.plist" ]]; then
    echo "$bundle_path"
  fi
}

get_opencode_main_pids() {
  local executable_path="$1"
  [[ -z "$executable_path" ]] && return 1

  ps -Ao pid=,args= 2>/dev/null | awk -v exe="$executable_path" '
    {
      pid = $1
      $1 = ""
      sub(/^ +/, "", $0)
      if ($0 == exe || index($0, exe " ") == 1) print pid
    }
  '
}

wait_for_new_opencode_pid() {
  local executable_path="$1"
  local existing_pids="${2:-}"
  local timeout_sec="${3:-15}"

  local deadline
  deadline=$(date +%s)
  deadline=$((deadline + timeout_sec))

  while true; do
    local now
    now=$(date +%s)
    if [[ $now -ge $deadline ]]; then
      return 1
    fi

    local current_pids
    current_pids="$(get_opencode_main_pids "$executable_path" || true)"
    if [[ -n "$current_pids" ]]; then
      local pid
      while IFS= read -r pid; do
        [[ -z "$pid" ]] && continue
        if [[ -z "$existing_pids" ]] || ! grep -Fxq "$pid" <<< "$existing_pids"; then
          echo "$pid"
          return 0
        fi
      done <<< "$current_pids"
    fi
    sleep 0.5
  done
}

start_opencode_app() {
  local executable_path="$1"
  shift

  if [[ ! -x "$executable_path" ]]; then
    echo "[ERROR] OpenCode executable not found: $executable_path" >&2
    return 1
  fi

  local bundle_path
  bundle_path="$(opencode_bundle_from_executable "$executable_path")"

  local pid
  if [[ -n "$bundle_path" ]] && command -v open &>/dev/null; then
    local existing_pids
    existing_pids="$(get_opencode_main_pids "$executable_path" || true)"
    if ! open -na "$bundle_path" --args "$@" > /dev/null 2>&1; then
      echo "[ERROR] Failed to launch OpenCode bundle: $bundle_path" >&2
      return 1
    fi
    pid="$(wait_for_new_opencode_pid "$executable_path" "$existing_pids" 15 || true)"
    if [[ -z "$pid" ]]; then
      echo "[ERROR] OpenCode did not expose a main process after launch: $bundle_path" >&2
      return 1
    fi
  else
    nohup "$executable_path" "$@" > /dev/null 2>&1 &
    pid=$!
  fi

  echo "[INFO] OpenCode started (PID: $pid)" >&2
  echo "$pid"
}

# ─── Stop OpenCode ────────────────────────────────────────────────────────────
# Stops OpenCode processes gracefully. Optionally force-kills after timeout.
# Arguments: executable_path (optional), timeout_sec (default 15), allow_force (default true)

stop_opencode_app() {
  local executable_path="${1:-}"
  local timeout_sec="${2:-15}"
  local allow_force="${3:-true}"

  local search_pattern="$APP_NAME"
  if [[ -n "$executable_path" ]]; then
    search_pattern="$(basename "$executable_path")"
  fi

  local pids
  pids="$(pgrep -f "$search_pattern" 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return 0
  fi

  # Graceful shutdown (SIGTERM)
  local pid
  for pid in $pids; do
    [[ -n "$pid" ]] && kill -TERM "$pid" 2>/dev/null || true
  done

  # Wait for processes to exit
  local deadline
  deadline=$(date +%s)
  deadline=$((deadline + timeout_sec))

  while true; do
    local now
    now=$(date +%s)
    if [[ $now -ge $deadline ]]; then
      break
    fi

    local remaining
    remaining="$(pgrep -f "$search_pattern" 2>/dev/null || true)"
    if [[ -z "$remaining" ]]; then
      return 0
    fi
    sleep 0.5
  done

  # Force kill
  if [[ "$allow_force" == "true" ]]; then
    local remaining
    remaining="$(pgrep -f "$search_pattern" 2>/dev/null || true)"
    for pid in $remaining; do
      [[ -n "$pid" ]] && kill -KILL "$pid" 2>/dev/null || true
    done
  fi

  return 0
}

# ─── Get running OpenCode processes ───────────────────────────────────────────

get_opencode_processes() {
  local executable_path="${1:-}"

  if [[ -n "$executable_path" ]]; then
    local pids
    pids="$(get_opencode_main_pids "$executable_path" || true)"
    if [[ -n "$pids" ]]; then
      local pid
      while IFS= read -r pid; do
        [[ -z "$pid" ]] && continue
        ps -p "$pid" -o pid=,args= 2>/dev/null || true
      done <<< "$pids"
    fi
  else
    pgrep -fl "$APP_NAME" 2>/dev/null || true
  fi
}

# ─── Check if a port is owned by OpenCode ─────────────────────────────────────
# Returns 0 if the port is listening and owned by an OpenCode process.

test_opencode_port_owner() {
  local port="$1"

  if ! command -v lsof &>/dev/null; then
    echo "[WARN] lsof not available, cannot check port owner" >&2
    return 1
  fi

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

# ─── Wait for CDP to be ready ─────────────────────────────────────────────────
# Polls the CDP /json/version endpoint until it responds or timeout.

wait_opencode_ready() {
  local port="${1:-$DEFAULT_CDP_PORT}"
  local timeout_sec="${2:-30}"
  local retry_interval="${3:-0.5}"

  if ! command -v curl &>/dev/null; then
    echo "[ERROR] curl is required but not found" >&2
    return 1
  fi

  local deadline
  deadline=$(date +%s)
  deadline=$((deadline + timeout_sec))

  while true; do
    local now
    now=$(date +%s)
    if [[ $now -ge $deadline ]]; then
      echo "[ERROR] CDP did not become ready on port $port within ${timeout_sec}s" >&2
      return 1
    fi

    if curl -s --max-time 2 "http://127.0.0.1:$port/json/version" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$retry_interval"
  done
}

# ─── Get OpenCode version ─────────────────────────────────────────────────────
# Returns the version string from the .app bundle Info.plist or CLI --version.

get_opencode_version() {
  local executable_path="$1"

  if [[ ! -x "$executable_path" ]]; then
    echo "[ERROR] Not an executable: $executable_path" >&2
    return 1
  fi

  # .app bundle: read Info.plist
  local bundle_path
  bundle_path="$(echo "$executable_path" | sed 's|/Contents/MacOS/.*|.app|')"
  if [[ -d "$bundle_path" && -f "$bundle_path/Contents/Info.plist" ]]; then
    if command -v /usr/libexec/PlistBuddy &>/dev/null; then
      /usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$bundle_path/Contents/Info.plist" 2>/dev/null || true
      return 0
    fi
  fi

  # CLI fallback
  "$executable_path" --version 2>/dev/null || true
}
