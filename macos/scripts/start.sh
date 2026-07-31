#!/usr/bin/env bash
# Start OpenCode with Dream Skin (macOS)
#
# Usage:
#   ./macos/scripts/start.sh
#   ./macos/scripts/start.sh --opencode-path "/Applications/OpenCode.app/Contents/MacOS/OpenCode"
#   ./macos/scripts/start.sh --port 9335 --theme-dir /path/to/assets
#
# Keyboard shortcut after injection: Ctrl+S to toggle settings panel

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ─── Source common functions ──────────────────────────────────────────────────

source "$SCRIPT_DIR/common.sh"

# ─── Defaults ─────────────────────────────────────────────────────────────────

DEFAULT_THEME_DIR="$PROJECT_ROOT/windows/assets"
INJECTOR_PATH="$PROJECT_ROOT/windows/scripts/injector.mjs"
IMAGE_SERVER_PATH="$PROJECT_ROOT/windows/scripts/image-server.mjs"
STATE_DIR="$HOME/.opencode-dream-skin"
STATE_FILE="$STATE_DIR/state.json"
PAUSE_FILE="$STATE_DIR/pause.flag"
INJECTOR_LOG="$STATE_DIR/injector.log"

# ─── Parse arguments ──────────────────────────────────────────────────────────

OPENCODE_PATH=""
CDP_PORT=$DEFAULT_CDP_PORT
THEME_DIR=""
NO_TRAY=false
PAUSE=false
DRY_RUN=false
STARTED_NEW_APP=false
INJECTOR_PID=""
IMAGE_SERVER_PID=""
OPENCODE_PID=""
CLEANUP_DONE=false
STATE_ENABLED=true

prepare_runtime_paths() {
  local temp_root="${TMPDIR:-/tmp}"
  local write_probe="$STATE_DIR/.write-test.$$"

  mkdir -p "$STATE_DIR" 2>/dev/null || true
  if touch "$write_probe" 2>/dev/null; then
    rm -f "$write_probe"
    return
  fi

  STATE_ENABLED=false
  STATE_FILE=""
  PAUSE_FILE="$temp_root/opencode-dream-skin-${CDP_PORT}.pause"
  INJECTOR_LOG="$temp_root/opencode-dream-skin-${CDP_PORT}.log"
  echo "[WARN] State directory is not writable, using temporary runtime files"
}

verify_skin_injection() {
  local timeout_ms="${1:-5000}"
  node "$INJECTOR_PATH" \
    --port "$CDP_PORT" \
    --auto-browser-id \
    --theme-dir "$THEME_DIR" \
    --verify \
    --timeout-ms "$timeout_ms" \
    > /dev/null 2>&1
}

cleanup() {
  local exit_code=$?
  if [[ "$CLEANUP_DONE" == "true" ]]; then
    return
  fi
  CLEANUP_DONE=true

  if [[ -n "$INJECTOR_PID" ]] && kill -0 "$INJECTOR_PID" 2>/dev/null; then
    echo "[INFO] Stopping injector..."
    kill -TERM "$INJECTOR_PID" 2>/dev/null || true
    wait "$INJECTOR_PID" 2>/dev/null || true
  fi

  if [[ -n "$IMAGE_SERVER_PID" ]] && kill -0 "$IMAGE_SERVER_PID" 2>/dev/null; then
    echo "[INFO] Stopping image server..."
    kill -TERM "$IMAGE_SERVER_PID" 2>/dev/null || true
    wait "$IMAGE_SERVER_PID" 2>/dev/null || true
  fi

  rm -f "$STATE_FILE" "$PAUSE_FILE"
  echo "[INFO] Cleanup complete"

  return "$exit_code"
}

handle_interrupt() {
  echo "[INFO] Received interrupt signal"
  if [[ "$STARTED_NEW_APP" == "true" ]]; then
    echo "[INFO] Stopping OpenCode..."
    stop_opencode_app "$OPENCODE_PATH" 5 true
  fi
  exit 130
}

trap cleanup EXIT
trap handle_interrupt INT TERM

while [[ $# -gt 0 ]]; do
  case "$1" in
    --opencode-path)
      OPENCODE_PATH="$2"
      shift 2
      ;;
    --port)
      CDP_PORT="$2"
      shift 2
      ;;
    --theme-dir)
      THEME_DIR="$2"
      shift 2
      ;;
    --no-tray)
      NO_TRAY=true
      shift
      ;;
    --pause)
      PAUSE=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      echo "OpenCode Dream Skin — macOS Launcher"
      echo ""
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --opencode-path <path>   Path to OpenCode executable"
      echo "  --port <port>             CDP debug port (default: $DEFAULT_CDP_PORT)"
      echo "  --theme-dir <dir>         Theme assets directory"
      echo "  --no-tray                 Skip menu bar integration (placeholder)"
      echo "  --pause                   Start with skin paused"
      echo "  --dry-run                 Print actions without executing"
      echo "  -h, --help                Show this help"
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown argument: $1" >&2
      echo "Usage: $0 [options] (use -h for help)" >&2
      exit 1
      ;;
  esac
done

# ─── Validate injector exists ─────────────────────────────────────────────────

if [[ ! -f "$INJECTOR_PATH" ]]; then
  echo "[ERROR] Injector not found at: $INJECTOR_PATH" >&2
  echo "  Expected location relative to project root: $PROJECT_ROOT" >&2
  exit 1
fi

# ─── Resolve theme directory ──────────────────────────────────────────────────

if [[ -z "$THEME_DIR" ]]; then
  THEME_DIR="$DEFAULT_THEME_DIR"
fi
if [[ ! -d "$THEME_DIR" ]]; then
  echo "[ERROR] Theme directory not found: $THEME_DIR" >&2
  exit 1
fi

# ─── Find OpenCode executable ─────────────────────────────────────────────────

if [[ -n "$OPENCODE_PATH" ]]; then
  if [[ ! -x "$OPENCODE_PATH" ]]; then
    echo "[ERROR] OpenCode not found at: $OPENCODE_PATH" >&2
    exit 1
  fi
else
  installs="$(find_opencode_install)"
  if [[ -z "$installs" ]]; then
    echo "[ERROR] OpenCode not found." >&2
    echo "  Please install OpenCode or specify --opencode-path" >&2
    exit 1
  fi
  OPENCODE_PATH="$(echo "$installs" | head -1)"
  echo "[INFO] Found OpenCode at: $OPENCODE_PATH"
fi

# ─── Check if already running ──────────────────────────────────────────────────

REUSE_RUNNING_APP=false
if test_opencode_port_owner "$CDP_PORT"; then
  echo "[INFO] Port $CDP_PORT is already in use by OpenCode"
  running="$(get_opencode_processes "$OPENCODE_PATH")"
  if [[ -n "$running" ]]; then
    OPENCODE_PID="$(get_opencode_main_pids "$OPENCODE_PATH" | head -1 || true)"
    if verify_skin_injection 5000; then
      echo "[INFO] OpenCode is already running with verified skin injection"
      exit 0
    fi
    echo "[INFO] Reusing existing OpenCode instance and restoring skin injection"
    REUSE_RUNNING_APP=true
  fi
fi

# ─── Dry run ───────────────────────────────────────────────────────────────────

if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "=== DRY RUN ==="
  echo "  OpenCode path:  $OPENCODE_PATH"
  echo "  CDP port:       $CDP_PORT"
  echo "  Theme dir:      $THEME_DIR"
  echo "  Injector:       $INJECTOR_PATH"
  echo "  Image server:   $IMAGE_SERVER_PATH"
  echo "  State file:     $STATE_FILE"
  echo "  Pause file:     $PAUSE_FILE"
  echo "  No tray:        $NO_TRAY"
  echo "  Pause:          $PAUSE"
  echo "================="
  exit 0
fi

# ─── Start OpenCode ───────────────────────────────────────────────────────────

cdp_arg="--remote-debugging-port=$CDP_PORT"
prepare_runtime_paths

if [[ ! -x "$OPENCODE_PATH" ]]; then
  echo "[ERROR] OpenCode not found: $OPENCODE_PATH" >&2
  exit 1
fi
if [[ "$REUSE_RUNNING_APP" != "true" ]]; then
  echo "[INFO] Starting OpenCode..."
  OPENCODE_PID="$(start_opencode_app "$OPENCODE_PATH" "$cdp_arg")"
  if [[ -z "$OPENCODE_PID" || ! "$OPENCODE_PID" =~ ^[0-9]+$ ]]; then
    echo "[ERROR] Failed to start OpenCode" >&2
    exit 1
  fi
  STARTED_NEW_APP=true
  echo "[INFO] OpenCode started (PID: $OPENCODE_PID)"
else
  echo "[INFO] Using running OpenCode PID: ${OPENCODE_PID:-unknown}"
fi

# ─── Wait for CDP readiness ────────────────────────────────────────────────────

echo "[INFO] Waiting for CDP to be ready on port $CDP_PORT..."
if ! wait_opencode_ready "$CDP_PORT" 30; then
  echo "[ERROR] CDP did not become ready within 30 seconds" >&2
  if [[ "$STARTED_NEW_APP" == "true" ]]; then
    stop_opencode_app "$OPENCODE_PATH" 5 true
  fi
  exit 1
fi
echo "[INFO] CDP is ready on port $CDP_PORT"

# ─── Start Image Server (background) ──────────────────────────────────────────

IMAGE_SERVER_PID=""
if [[ -f "$IMAGE_SERVER_PATH" ]]; then
  echo "[INFO] Starting image server..."
  node "$IMAGE_SERVER_PATH" --port 18765 --theme-dir "$THEME_DIR" > /dev/null 2>&1 &
  IMAGE_SERVER_PID=$!
  echo "[INFO] Image server started (PID: $IMAGE_SERVER_PID)"
fi

# ─── Inject skin ──────────────────────────────────────────────────────────────

echo "[INFO] Injecting skin..."
injector_args=(
  "--port" "$CDP_PORT"
  "--auto-browser-id"
  "--theme-dir" "$THEME_DIR"
  "--watch"
  "--timeout-ms" "30000"
  "--pause-file" "$PAUSE_FILE"
)
if [[ "$PAUSE" == "true" ]]; then
  : > "$PAUSE_FILE"
else
  rm -f "$PAUSE_FILE"
fi

rm -f "$INJECTOR_LOG"
node "$INJECTOR_PATH" "${injector_args[@]}" > "$INJECTOR_LOG" 2>&1 &
INJECTOR_PID=$!
echo "[INFO] Injector started (PID: $INJECTOR_PID)"

if [[ "$PAUSE" == "true" ]]; then
  if kill -0 "$INJECTOR_PID" 2>/dev/null; then
    echo "[INFO] Skin watcher started in paused mode"
  else
    echo "[WARN] Skin watcher exited unexpectedly while starting paused"
    tail -n 20 "$INJECTOR_LOG" 2>/dev/null || true
  fi
else
  skin_verified=false
  for _ in $(seq 1 20); do
    if ! kill -0 "$INJECTOR_PID" 2>/dev/null; then
      break
    fi
    if verify_skin_injection 5000; then
      skin_verified=true
      break
    fi
    sleep 1
  done

  if [[ "$skin_verified" == "true" ]]; then
    echo "[INFO] Skin injection verified"
  else
    echo "[WARN] Skin injection could not be verified"
    tail -n 20 "$INJECTOR_LOG" 2>/dev/null || true
  fi
fi

# ─── Save state ────────────────────────────────────────────────────────────────

if [[ "$STATE_ENABLED" == "true" ]]; then
  cat > "$STATE_FILE" << EOF
{
  "OpenCodePath": "$OPENCODE_PATH",
  "CdpPort": $CDP_PORT,
  "ThemeDir": "$THEME_DIR",
  "InjectorPid": ${INJECTOR_PID:-null},
  "PauseFile": "$PAUSE_FILE",
  "StartTime": "$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")",
  "Version": "2.0.0"
}
EOF
  echo "[INFO] State saved to: $STATE_FILE"
else
  echo "[INFO] State persistence is disabled for this run"
fi

# ─── Wait for OpenCode to exit ────────────────────────────────────────────────

echo "[INFO] OpenCode is running. Press Ctrl+C to stop."
echo "[INFO] Press Ctrl+S in OpenCode to toggle settings panel."

if [[ -n "$OPENCODE_PID" && "$OPENCODE_PID" =~ ^[0-9]+$ ]]; then
  while kill -0 "$OPENCODE_PID" 2>/dev/null; do
    sleep 1
  done
else
  while test_opencode_port_owner "$CDP_PORT"; do
    sleep 1
  done
fi
echo "[INFO] OpenCode exited"
