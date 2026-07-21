#!/usr/bin/env bash
# Start OpenCode with Dream Skin (macOS)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ─── Source common functions ──────────────────────────────────────────────────

source "$SCRIPT_DIR/common.sh"

# ─── Parse arguments ─────────────────────────────────────────────────────────

OPENCODE_PATH=""
CDP_PORT=9335
THEME_DIR=""
NO_TRAY=false
PAUSE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --opencode-path) OPENCODE_PATH="$2"; shift 2 ;;
    --port) CDP_PORT="$2"; shift 2 ;;
    --theme-dir) THEME_DIR="$2"; shift 2 ;;
    --no-tray) NO_TRAY=true; shift ;;
    --pause) PAUSE=true; shift ;;
    -h|--help)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --opencode-path <path>   Path to OpenCode executable"
      echo "  --port <port>             CDP debug port (default: 9335)"
      echo "  --theme-dir <dir>         Theme directory"
      echo "  --no-tray                 Skip menu bar app"
      echo "  --pause                   Start with skin paused"
      echo "  -h, --help                Show this help"
      exit 0
      ;;
    *) echo "[ERROR] Unknown argument: $1" >&2; exit 1 ;;
  esac
done

# ─── Find OpenCode ────────────────────────────────────────────────────────────

if [[ -n "$OPENCODE_PATH" ]]; then
  if [[ ! -x "$OPENCODE_PATH" ]]; then
    echo "[ERROR] OpenCode not found at: $OPENCODE_PATH" >&2
    exit 1
  fi
  echo "[INFO] Using OpenCode at: $OPENCODE_PATH"
else
  installs="$(find_opencode_install)"
  if [[ -z "$installs" ]]; then
    echo "[ERROR] OpenCode not found. Please specify --opencode-path." >&2
    exit 1
  fi
  OPENCODE_PATH="$(echo "$installs" | head -1)"
  echo "[INFO] Found OpenCode at: $OPENCODE_PATH"
fi

# ─── Check for existing instance ──────────────────────────────────────────────

if test_opencode_port_owner "$CDP_PORT"; then
  echo "[WARN] Port $CDP_PORT already in use by OpenCode"
  echo "[INFO] OpenCode is already running with skin injection"
  exit 0
fi

# ─── Start OpenCode with CDP ─────────────────────────────────────────────────

echo "[INFO] Starting OpenCode..."
start_opencode_app "$OPENCODE_PATH" "--remote-debugging-port=$CDP_PORT"

# ─── Wait for CDP ─────────────────────────────────────────────────────────────

echo "[INFO] Waiting for CDP to be ready..."
if ! wait_opencode_ready "$CDP_PORT" 30; then
  echo "[ERROR] CDP did not become ready within 30 seconds" >&2
  exit 1
fi
echo "[INFO] CDP is ready on port $CDP_PORT"

# ─── Start image server ──────────────────────────────────────────────────────

IMAGE_SERVER_PATH="$PROJECT_ROOT/scripts/image-server.mjs"
EFFECTIVE_THEME_DIR="${THEME_DIR:-$PROJECT_ROOT/assets}"

if [[ -f "$IMAGE_SERVER_PATH" ]]; then
  nohup node "$IMAGE_SERVER_PATH" --port 18765 --theme-dir "$EFFECTIVE_THEME_DIR" > /dev/null 2>&1 &
  echo "[INFO] Image server started (PID: $!)"
fi

# ─── Start injector ──────────────────────────────────────────────────────────

INJECTOR_PATH="$PROJECT_ROOT/scripts/injector.mjs"

if [[ ! -f "$INJECTOR_PATH" ]]; then
  echo "[ERROR] Injector not found at: $INJECTOR_PATH" >&2
  exit 1
fi

INJECTOR_ARGS=(
  "--port" "$CDP_PORT"
  "--auto-browser-id"
  "--watch"
  "--theme-dir" "$EFFECTIVE_THEME_DIR"
)

if [[ "$PAUSE" == "true" ]]; then
  INJECTOR_ARGS+=("--pause")
fi

echo "[INFO] Injecting skin..."
nohup node "$INJECTOR_PATH" "${INJECTOR_ARGS[@]}" > /dev/null 2>&1 &
INJECTOR_PID=$!
echo "[INFO] Injector started (PID: $INJECTOR_PID)"

# ─── Save state ───────────────────────────────────────────────────────────────

STATE_DIR="$HOME/Library/Application Support/OpenCodeDreamSkin"
mkdir -p "$STATE_DIR"
STATE_FILE="$STATE_DIR/state.json"

cat > "$STATE_FILE" << STATEEOF
{
  "opencodePath": "$OPENCODE_PATH",
  "cdpPort": $CDP_PORT,
  "injectorPid": $INJECTOR_PID,
  "themeDir": "$EFFECTIVE_THEME_DIR",
  "startTime": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
STATEEOF

echo "[INFO] State saved to: $STATE_FILE"

# ─── Start menu bar (Phase 4 — placeholder for now) ───────────────────────────

if [[ "$NO_TRAY" != "true" ]]; then
  echo "[INFO] Menu bar app not yet implemented (Phase 4). Use --no-tray to suppress this message."
fi

# ─── Wait for OpenCode to exit, then clean up ─────────────────────────────────

echo ""
echo "[OK] OpenCode Dream Skin is active!"
echo "[INFO] Press Ctrl+C to stop"
echo ""

cleanup() {
  echo ""
  echo "[INFO] Shutting down..."
  if kill -0 "$INJECTOR_PID" 2>/dev/null; then
    kill "$INJECTOR_PID" 2>/dev/null || true
    echo "[INFO] Injector stopped"
  fi
  # Stop image server
  local server_pid
  server_pid="$(pgrep -f "image-server.mjs" 2>/dev/null || true)"
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    echo "[INFO] Image server stopped"
  fi
  rm -f "$STATE_FILE"
  echo "[INFO] State file removed"
  echo "[OK] Cleanup complete"
}

trap cleanup EXIT INT TERM

# Wait for OpenCode process
while pgrep -f "$(basename "$OPENCODE_PATH")" > /dev/null 2>&1; do
  sleep 2
done

echo "[INFO] OpenCode exited"
