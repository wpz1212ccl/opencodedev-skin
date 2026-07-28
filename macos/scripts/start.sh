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

# ─── Parse arguments ──────────────────────────────────────────────────────────

OPENCODE_PATH=""
CDP_PORT=$DEFAULT_CDP_PORT
THEME_DIR=""
NO_TRAY=false
PAUSE=false
DRY_RUN=false

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

if test_opencode_port_owner "$CDP_PORT"; then
  echo "[INFO] Port $CDP_PORT is already in use by OpenCode"
  running="$(get_opencode_processes "$OPENCODE_PATH")"
  if [[ -n "$running" ]]; then
    echo "[INFO] OpenCode is already running with skin injection"
    exit 0
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
  echo "  No tray:        $NO_TRAY"
  echo "  Pause:          $PAUSE"
  echo "================="
  exit 0
fi

# ─── Start OpenCode ───────────────────────────────────────────────────────────

echo "[INFO] Starting OpenCode..."

cdp_arg="--remote-debugging-port=$CDP_PORT"

# Must start in current shell (not $()) so PID is trackable with `wait`
if [[ ! -x "$OPENCODE_PATH" ]]; then
  echo "[ERROR] OpenCode not found: $OPENCODE_PATH" >&2
  exit 1
fi
nohup "$OPENCODE_PATH" "$cdp_arg" > /dev/null 2>&1 &
OPENCODE_PID=$!

if [[ -z "$OPENCODE_PID" || "$OPENCODE_PID" -eq 0 ]]; then
  echo "[ERROR] Failed to start OpenCode" >&2
  exit 1
fi

echo "[INFO] OpenCode started (PID: $OPENCODE_PID)"

# ─── Wait for CDP readiness ────────────────────────────────────────────────────

echo "[INFO] Waiting for CDP to be ready on port $CDP_PORT..."
if ! wait_opencode_ready "$CDP_PORT" 30; then
  echo "[ERROR] CDP did not become ready within 30 seconds" >&2
  stop_opencode_app "$OPENCODE_PATH" 5 true
  exit 1
fi
echo "[INFO] CDP is ready on port $CDP_PORT"

# ─── Start Image Server (background) ──────────────────────────────────────────

IMAGE_SERVER_PID=""
if [[ -f "$IMAGE_SERVER_PATH" ]]; then
  echo "[INFO] Starting image server..."
  nohup node "$IMAGE_SERVER_PATH" --port 18765 --theme-dir "$THEME_DIR" > /dev/null 2>&1 &
  IMAGE_SERVER_PID=$!
  echo "[INFO] Image server started (PID: $IMAGE_SERVER_PID)"
fi

# ─── Inject skin ──────────────────────────────────────────────────────────────

echo "[INFO] Injecting skin..."
injector_args=(
  "--port" "$CDP_PORT"
  "--auto-browser-id"
  "--theme-dir" "$THEME_DIR"
  "--once"
  "--timeout-ms" "15000"
)
if [[ "$PAUSE" == "true" ]]; then
  injector_args+=("--pause")
fi

set +e
node "$INJECTOR_PATH" "${injector_args[@]}"
injector_exit=$?
set -e

if [[ $injector_exit -eq 0 || $injector_exit -eq 2 ]]; then
  echo "[INFO] Skin injection completed"
else
  echo "[WARN] Skin injection may have failed (exit code: $injector_exit)"
fi

# ─── Save state ────────────────────────────────────────────────────────────────

mkdir -p "$STATE_DIR"

cat > "$STATE_FILE" << EOF
{
  "OpenCodePath": "$OPENCODE_PATH",
  "CdpPort": $CDP_PORT,
  "ThemeDir": "$THEME_DIR",
  "InjectorPid": null,
  "StartTime": "$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")",
  "Version": "2.0.0"
}
EOF
echo "[INFO] State saved to: $STATE_FILE"

# ─── Wait for OpenCode to exit ────────────────────────────────────────────────

echo "[INFO] OpenCode is running. Press Ctrl+C to stop."
echo "[INFO] Press Ctrl+S in OpenCode to toggle settings panel."

wait "$OPENCODE_PID" 2>/dev/null || true
echo "[INFO] OpenCode exited"

# ─── Cleanup ──────────────────────────────────────────────────────────────────

if [[ -n "$IMAGE_SERVER_PID" ]] && kill -0 "$IMAGE_SERVER_PID" 2>/dev/null; then
  echo "[INFO] Stopping image server..."
  kill -TERM "$IMAGE_SERVER_PID" 2>/dev/null || true
fi

rm -f "$STATE_FILE"
echo "[INFO] Cleanup complete"
