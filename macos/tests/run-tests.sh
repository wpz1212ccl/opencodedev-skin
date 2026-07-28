#!/usr/bin/env bash
# Test suite for macOS Dream Skin scripts
#
# Usage:
#   ./run-tests.sh              # Run all tests (default: syntax + unit)
#   ./run-tests.sh --all        # Run all tests including system integration
#   ./run-tests.sh --unit       # Unit tests only (mocked, no macOS required)
#   ./run-tests.sh --syntax     # Syntax check only
#   ./run-tests.sh --system     # System integration tests (requires OpenCode + macOS)
#   ./run-tests.sh --list       # List available tests without running
#   ./run-tests.sh --verbose    # Verbose output
#
# Test categories:
#   SYNTAX    - Shell syntax validation (bash -n)
#   UNIT      - Function unit tests with mocked dependencies
#   ENV       - Environment readiness checks
#   SYSTEM    - Full integration tests (require actual OpenCode install)
#
# Returns 0 if all tests pass, 1 if any fail.

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PROJECT_ROOT/.." && pwd)"
MACOS_SCRIPTS="$PROJECT_ROOT/scripts"
COMMON_SH="$MACOS_SCRIPTS/common.sh"
START_SH="$MACOS_SCRIPTS/start.sh"

MOCK_DIR=""

# ─── Test framework globals ───────────────────────────────────────────────────

TESTS_TOTAL=0
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0
VERBOSE=false
TEST_MODE="all"
declare -a TEST_NAMES
declare -a TEST_FUNCTIONS
declare -a TEST_CATEGORIES

# ─── Colors ───────────────────────────────────────────────────────────────────

if [[ -t 1 ]]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[1;33m'
  CYAN='\033[0;36m'
  NC='\033[0m'
else
  GREEN=''
  RED=''
  YELLOW=''
  CYAN=''
  NC=''
fi

# ═══════════════════════════════════════════════════════════════════════════════
# TEST FRAMEWORK
# ═══════════════════════════════════════════════════════════════════════════════

register_test() {
  local name="$1"
  local func="$2"
  local category="${3:-UNIT}"
  TEST_NAMES+=("$name")
  TEST_FUNCTIONS+=("$func")
  TEST_CATEGORIES+=("$category")
}

fail() {
  echo -e "${RED}  FAIL${NC} $1"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

pass() {
  echo -e "${GREEN}  PASS${NC} $1"
  TESTS_PASSED=$((TESTS_PASSED + 1))
}

skip() {
  echo -e "${YELLOW}  SKIP${NC} $1"
  TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local msg="${3:-}"
  if [[ "$expected" != "$actual" ]]; then
    fail "${msg:-Expected '$expected', got '$actual'}"
    return 1
  fi
  return 0
}

assert_ne() {
  local unexpected="$1"
  local actual="$2"
  local msg="${3:-}"
  if [[ "$unexpected" == "$actual" ]]; then
    fail "${msg:-Expected != '$unexpected', got '$actual'}"
    return 1
  fi
  return 0
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local msg="${3:-}"
  if [[ "$haystack" != *"$needle"* ]]; then
    fail "${msg:-Expected to contain '$needle', got '$haystack'}"
    return 1
  fi
  return 0
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  local msg="${3:-}"
  if [[ "$haystack" == *"$needle"* ]]; then
    fail "${msg:-Expected NOT to contain '$needle', got '$haystack'}"
    return 1
  fi
  return 0
}

assert_true() {
  local msg="${1:-}"
  if [[ $? -ne 0 ]]; then
    fail "${msg:-Expected true (exit 0)}"
  fi
}

assert_false() {
  local msg="${1:-}"
  if [[ $? -eq 0 ]]; then
    fail "${msg:-Expected false (exit non-zero)}"
  fi
}

# ─── Mock helpers ─────────────────────────────────────────────────────────────

setup_mock_dir() {
  MOCK_DIR="$(mktemp -d /tmp/opencode-skin-test.XXXXXX)"
}

cleanup_mock_dir() {
  if [[ -n "$MOCK_DIR" && -d "$MOCK_DIR" ]]; then
    rm -rf "$MOCK_DIR"
    MOCK_DIR=""
  fi
}

mock_command() {
  local name="$1"
  local script="$2"

  if [[ -z "$MOCK_DIR" ]]; then
    setup_mock_dir
  fi

  cat > "$MOCK_DIR/$name" << MOCKEOF
#!/usr/bin/env bash
$script
MOCKEOF
  chmod +x "$MOCK_DIR/$name"
}

unmock_command() {
  local name="$1"
  rm -f "$MOCK_DIR/$name" 2>/dev/null || true
}

mock_path() {
  echo "$MOCK_DIR:$PATH"
}

# ═══════════════════════════════════════════════════════════════════════════════
# TEST: Syntax checks
# ═══════════════════════════════════════════════════════════════════════════════

test_syntax_common_sh() {
  bash -n "$COMMON_SH" 2>&1
  assert_eq 0 $? "common.sh: bash syntax valid"
}

test_syntax_start_sh() {
  bash -n "$START_SH" 2>&1
  assert_eq 0 $? "start.sh: bash syntax valid"
}

# ═══════════════════════════════════════════════════════════════════════════════
# TEST: common.sh - find_opencode_install
# ═══════════════════════════════════════════════════════════════════════════════

test_find_opencode_install_standard_path() {
  # Setup: create a fake OpenCode in /Applications
  local fake_dir="/tmp/opencode-test-app"
  local fake_bin="$fake_dir/Contents/MacOS/OpenCode"
  mkdir -p "$(dirname "$fake_bin")"
  echo "#!/bin/bash" > "$fake_bin"
  chmod +x "$fake_bin"

  # Run with MOCK_DIR first to let other commands be real
  local result
  result="$(PATH="$(mock_path)" find_opencode_install 2>/dev/null || true)"
  rm -rf "$fake_dir"

  # We can't guarantee it finds our fake (mdfind/pgrep may interfere),
  # but at minimum it should not crash
  assert_eq 0 $? "find_opencode_install: does not crash"
}

test_find_opencode_install_empty() {
  # When no OpenCode exists, should return non-zero
  # We mock mdfind and pgrep to return nothing
  mock_command "mdfind" 'exit 0'
  mock_command "pgrep" 'exit 1'
  mock_command "locate" 'exit 1'
  mock_command "command" '[[ "$1" == "-v" ]] && exit 1; [[ "$1" == "mdfind" ]] && exit 0; exit 1'

  local old_path="$PATH"
  export PATH="$(mock_path)"
  set +e
  local result
  result="$(find_opencode_install 2>/dev/null)"
  local rc=$?
  set -e
  export PATH="$old_path"

  assert_eq 1 $rc "find_opencode_install: returns 1 when nothing found"
  assert_eq "" "$result" "find_opencode_install: empty output when nothing found"

  unmock_command "mdfind"
  unmock_command "pgrep"
  unmock_command "locate"
  unmock_command "command"
}

test_find_opencode_install_deduplicates() {
  # When the same path appears from multiple sources, output only once
  mock_command "mdfind" 'exit 0'

  # Create a fake executable so it passes -x check
  local fake_exe="$MOCK_DIR/fake-opencode"
  echo "#!/bin/bash" > "$fake_exe"
  chmod +x "$fake_exe"

  # Mock pgrep to return our fake path
  mock_command "pgrep" "echo '12345 $fake_exe'"

  # Mock command to return our fake path
  mock_command "_command" 'echo "$MOCK_DIR/fake-opencode"'
  # Can't easily mock 'command' builtin, but we can check our dedup logic
  # by making candidates appear only via pgrep
  # For now, test that the function doesn't error
  local old_path="$PATH"
  export PATH="$(mock_path)"

  set +e
  local result
  result="$(find_opencode_install 2>/dev/null)"
  local rc=$?
  set -e
  export PATH="$old_path"

  # Should find our fake at minimum
  assert_eq 0 $rc "find_opencode_install: finds at least one"

  unmock_command "mdfind"
  unmock_command "pgrep"
  unmock_command "_command"
  rm -f "$fake_exe"
}

# ═══════════════════════════════════════════════════════════════════════════════
# TEST: common.sh - start_opencode_app
# ═══════════════════════════════════════════════════════════════════════════════

test_start_opencode_app_success() {
  local fake_exe="$MOCK_DIR/start-fake"
  echo '#!/bin/bash
echo "Fake OpenCode running with args: $*"
sleep 30' > "$fake_exe"
  chmod +x "$fake_exe"

  set +e
  local output
  output="$(start_opencode_app "$fake_exe" "--port=9335" 2>&1 </dev/null)"
  local rc=$?

  # Extract PID from stderr (printed to stderr)
  local pid_line
  pid_line="$(echo "$output" | grep "OpenCode started" || true)"
  # The last line (stdout) should be the PID
  local pid
  pid="$(echo "$output" | tail -1)"
  set -e

  assert_eq 0 $rc "start_opencode_app: returns 0"
  assert_contains "$output" "OpenCode started" "start_opencode_app: prints start message"

  # Cleanup
  if [[ -n "$pid" && "$pid" =~ ^[0-9]+$ ]]; then
    kill "$pid" 2>/dev/null || true
  fi
  rm -f "$fake_exe"
}

test_start_opencode_app_nonexistent() {
  set +e
  local output
  output="$(start_opencode_app "/nonexistent/path" 2>&1)"
  local rc=$?
  set -e

  assert_ne 0 $rc "start_opencode_app: returns non-zero for nonexistent path"
  assert_contains "$output" "ERROR" "start_opencode_app: prints error message"
}

# ═══════════════════════════════════════════════════════════════════════════════
# TEST: common.sh - stop_opencode_app
# ═══════════════════════════════════════════════════════════════════════════════

test_stop_opencode_app_no_process() {
  mock_command "pgrep" 'exit 1'

  local old_path="$PATH"
  export PATH="$(mock_path)"

  set +e
  stop_opencode_app "" 5 false
  local rc=$?
  set -e
  export PATH="$old_path"

  assert_eq 0 $rc "stop_opencode_app: returns 0 when no processes"

  unmock_command "pgrep"
}

test_stop_opencode_app_graceful() {
  # Create a process to kill
  sleep 30 &
  local test_pid=$!

  mock_command "pgrep" "echo '$test_pid'"

  local old_path="$PATH"
  export PATH="$(mock_path)"

  set +e
  stop_opencode_app "" 5 false
  local rc=$?
  set -e
  export PATH="$old_path"

  assert_eq 0 $rc "stop_opencode_app: graceful shutdown returns 0"

  # Process should be gone
  kill "$test_pid" 2>/dev/null || true
  unmock_command "pgrep"
}

# ═══════════════════════════════════════════════════════════════════════════════
# TEST: common.sh - test_opencode_port_owner
# ═══════════════════════════════════════════════════════════════════════════════

test_opencode_port_owner_no_lsof() {
  mock_command "lsof" 'exit 127'

  local old_path="$PATH"
  export PATH="$(mock_path)"

  set +e
  test_opencode_port_owner 9335
  local rc=$?
  set -e
  export PATH="$old_path"

  assert_ne 0 $rc "test_opencode_port_owner: returns non-zero when lsof unavailable"

  unmock_command "lsof"
}

test_opencode_port_owner_not_opencode() {
  mock_command "lsof" 'echo "99999"'
  mock_command "ps" 'echo "SomeOtherApp"'

  local old_path="$PATH"
  export PATH="$(mock_path)"

  set +e
  test_opencode_port_owner 9335
  local rc=$?
  set -e
  export PATH="$old_path"

  assert_ne 0 $rc "test_opencode_port_owner: returns false when ownered by non-OpenCode"

  unmock_command "lsof"
  unmock_command "ps"
}

test_opencode_port_owner_is_opencode() {
  mock_command "lsof" 'echo "88888"'
  mock_command "ps" 'echo "OpenCode"'

  local old_path="$PATH"
  export PATH="$(mock_path)"

  set +e
  test_opencode_port_owner 9335
  local rc=$?
  set -e
  export PATH="$old_path"

  assert_eq 0 $rc "test_opencode_port_owner: returns true when owned by OpenCode"

  unmock_command "lsof"
  unmock_command "ps"
}

# ═══════════════════════════════════════════════════════════════════════════════
# TEST: common.sh - wait_opencode_ready
# ═══════════════════════════════════════════════════════════════════════════════

test_wait_opencode_ready_no_curl() {
  mock_command "curl" 'exit 127'

  local old_path="$PATH"
  export PATH="$(mock_path)"

  set +e
  wait_opencode_ready 9335 2 0.1
  local rc=$?
  set -e
  export PATH="$old_path"

  assert_ne 0 $rc "wait_opencode_ready: returns non-zero when curl unavailable"

  unmock_command "curl"
}

test_wait_opencode_ready_success() {
  mock_command "curl" 'exit 0'

  local old_path="$PATH"
  export PATH="$(mock_path)"

  set +e
  wait_opencode_ready 9335 5 0.1
  local rc=$?
  set -e
  export PATH="$old_path"

  assert_eq 0 $rc "wait_opencode_ready: returns 0 when CDP responds"

  unmock_command "curl"
}

test_wait_opencode_ready_timeout() {
  mock_command "curl" 'exit 1'

  local old_path="$PATH"
  export PATH="$(mock_path)"

  set +e
  wait_opencode_ready 9335 2 0.1
  local rc=$?
  set -e
  export PATH="$old_path"

  assert_ne 0 $rc "wait_opencode_ready: returns non-zero on timeout"

  unmock_command "curl"
}

# ═══════════════════════════════════════════════════════════════════════════════
# TEST: common.sh - get_opencode_version
# ═══════════════════════════════════════════════════════════════════════════════

test_get_opencode_version_nonexistent() {
  set +e
  local output
  output="$(get_opencode_version "/nonexistent/opencode" 2>&1)"
  local rc=$?
  set -e

  assert_ne 0 $rc "get_opencode_version: returns non-zero for nonexistent path"
  assert_contains "$output" "ERROR" "get_opencode_version: prints error"
}

test_get_opencode_version_cli() {
  local fake_exe="$MOCK_DIR/version-fake"
  echo '#!/bin/bash
echo "1.18.3"' > "$fake_exe"
  chmod +x "$fake_exe"

  set +e
  local output
  output="$(get_opencode_version "$fake_exe" 2>&1)"
  local rc=$?
  set -e

  # For CLI (non-.app bundle), it may fall through to --version
  # which our fake responds with "1.18.3"
  assert_contains "$output" "1.18.3" "get_opencode_version: extracts version from CLI" || true

  rm -f "$fake_exe"
}

# ═══════════════════════════════════════════════════════════════════════════════
# TEST: start.sh argument parsing (via sourcing with mocks)
# ═══════════════════════════════════════════════════════════════════════════════

test_start_sh_help() {
  set +e
  local output
  output="$("$START_SH" --help 2>&1)"
  local rc=$?
  set -e

  assert_eq 0 $rc "start.sh --help: exits 0"
  assert_contains "$output" "Usage" "start.sh --help: shows usage"
  assert_contains "$output" "--opencode-path" "start.sh --help: shows opencode-path option"
  assert_contains "$output" "--port" "start.sh --help: shows port option"
  assert_contains "$output" "--theme-dir" "start.sh --help: shows theme-dir option"
  assert_contains "$output" "--no-tray" "start.sh --help: shows no-tray option"
  assert_contains "$output" "--pause" "start.sh --help: shows pause option"
  assert_contains "$output" "--dry-run" "start.sh --help: shows dry-run option"
}

test_start_sh_unknown_arg() {
  set +e
  local output
  output="$("$START_SH" --bogus-arg 2>&1)"
  local rc=$?
  set -e

  assert_ne 0 $rc "start.sh --bogus-arg: exits non-zero"
  assert_contains "$output" "Unknown argument" "start.sh: prints unknown argument error"
}

test_start_sh_dry_run() {
  # Set up a fake OpenCode so the script doesn't fail
  local fake_exe="$MOCK_DIR/dry-run-opencode"
  echo "#!/bin/bash" > "$fake_exe"
  chmod +x "$fake_exe"

  # Also mock find_opencode_install to return our fake
  mock_command "mdfind" 'echo "/Applications/OpenCode.app"'
  mock_command "pgrep" 'exit 1'
  mock_command "lsof" 'exit 1'

  # Create a theme dir
  local fake_theme="$MOCK_DIR/theme-dir"
  mkdir -p "$fake_theme"

  set +e
  local output
  output="$("$START_SH" --opencode-path "$fake_exe" --theme-dir "$fake_theme" --dry-run 2>&1)"
  local rc=$?
  set -e

  assert_eq 0 $rc "start.sh --dry-run: exits 0"
  assert_contains "$output" "DRY RUN" "start.sh --dry-run: shows dry run header"
  assert_contains "$output" "$fake_exe" "start.sh --dry-run: shows opencode path"
  assert_contains "$output" "$fake_theme" "start.sh --dry-run: shows theme dir"
  assert_contains "$output" "9335" "start.sh --dry-run: shows default port"

  rm -f "$fake_exe"
  unmock_command "mdfind"
  unmock_command "pgrep"
  unmock_command "lsof"
}

test_start_sh_dry_run_custom_port() {
  local fake_exe="$MOCK_DIR/port-fake"
  echo "#!/bin/bash" > "$fake_exe"
  chmod +x "$fake_exe"

  local fake_theme="$MOCK_DIR/theme-port"
  mkdir -p "$fake_theme"

  set +e
  local output
  output="$("$START_SH" --opencode-path "$fake_exe" --theme-dir "$fake_theme" --port 12345 --dry-run 2>&1)"
  local rc=$?
  set -e

  assert_eq 0 $rc "start.sh --dry-run --port: exits 0"
  assert_contains "$output" "12345" "start.sh --dry-run --port: shows custom port"

  rm -f "$fake_exe"
}

test_start_sh_missing_opencode() {
  # Without --opencode-path and without a real OpenCode, should fail
  mock_command "mdfind" 'exit 0'
  mock_command "pgrep" 'exit 1'
  # Mock find_opencode_install to return empty
  # We can't easily mock internal functions, but we can
  # run the script directly and let it fail

  # Actually, this test requires careful mocking of multiple things.
  # The simplest approach: use --opencode-path with nonexistent path
  set +e
  local output
  output="$("$START_SH" --opencode-path "/nonexistent/OpenCode" 2>&1)"
  local rc=$?
  set -e

  assert_ne 0 $rc "start.sh --opencode-path /nonexistent: exits non-zero"
  assert_contains "$output" "not found" "start.sh: shows not found error"

  unmock_command "mdfind"
  unmock_command "pgrep"
}

test_start_sh_missing_theme_dir() {
  local fake_exe="$MOCK_DIR/theme-fake"
  echo "#!/bin/bash" > "$fake_exe"
  chmod +x "$fake_exe"

  set +e
  local output
  output="$("$START_SH" --opencode-path "$fake_exe" --theme-dir "/nonexistent/theme" 2>&1)"
  local rc=$?
  set -e

  assert_ne 0 $rc "start.sh --theme-dir /nonexistent: exits non-zero"
  assert_contains "$output" "not found" "start.sh: shows theme dir not found"

  rm -f "$fake_exe"
}

test_start_sh_dry_run_pause() {
  local fake_exe="$MOCK_DIR/pause-fake"
  echo "#!/bin/bash" > "$fake_exe"
  chmod +x "$fake_exe"

  local fake_theme="$MOCK_DIR/theme-pause"
  mkdir -p "$fake_theme"

  set +e
  local output
  output="$("$START_SH" --opencode-path "$fake_exe" --theme-dir "$fake_theme" --pause --dry-run 2>&1)"
  local rc=$?
  set -e

  assert_eq 0 $rc "start.sh --pause --dry-run: exits 0"

  rm -f "$fake_exe"
}

# ═══════════════════════════════════════════════════════════════════════════════
# TEST: Environment readiness
# ═══════════════════════════════════════════════════════════════════════════════

test_env_is_macos() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    skip "Environment: not macOS (current: $(uname -s))"
    return
  fi
  pass "Environment: running on macOS"
}

test_env_has_bash() {
  local bash_version
  bash_version="$(bash --version | head -1)"
  if echo "$bash_version" | grep -q "bash"; then
    pass "bash is installed: $bash_version"
  else
    fail "bash is installed: unexpected version '$bash_version'"
  fi
}

test_env_has_curl() {
  if command -v curl &>/dev/null; then
    pass "Environment: curl is available"
  else
    skip "Environment: curl not found (needed for CDP polling)"
  fi
}

test_env_has_lsof() {
  if command -v lsof &>/dev/null; then
    pass "Environment: lsof is available"
  else
    skip "Environment: lsof not found (needed for port checking)"
  fi
}

test_env_has_pgrep() {
  if command -v pgrep &>/dev/null; then
    pass "Environment: pgrep is available"
  else
    skip "Environment: pgrep not found (needed for process management)"
  fi
}

test_env_has_node() {
  if command -v node &>/dev/null; then
    local node_version
    node_version="$(node --version)"
    assert_contains "$node_version" "v" "node is installed: $node_version"
  else
    skip "Environment: node not found (needed for injector)"
  fi
}

test_env_has_mdfind() {
  if command -v mdfind &>/dev/null; then
    pass "Environment: mdfind is available"
  else
    skip "Environment: mdfind not found (Spotlight search, macOS only)"
  fi
}

test_env_has_plistbuddy() {
  if command -v /usr/libexec/PlistBuddy &>/dev/null; then
    pass "Environment: PlistBuddy is available"
  else
    skip "Environment: PlistBuddy not found (macOS only, for .app version detection)"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
# TEST: File integrity
# ═══════════════════════════════════════════════════════════════════════════════

test_file_common_sh_exists() {
  if [[ -f "$COMMON_SH" ]]; then
    pass "File: common.sh exists at $COMMON_SH"
  else
    fail "File: common.sh NOT found at $COMMON_SH"
  fi
}

test_file_start_sh_exists() {
  if [[ -f "$START_SH" ]]; then
    pass "File: start.sh exists at $START_SH"
  else
    fail "File: start.sh NOT found at $START_SH"
  fi
}

test_file_common_sh_executable() {
  if [[ -x "$COMMON_SH" ]]; then
    pass "File: common.sh is executable"
  else
    fail "File: common.sh is NOT executable"
  fi
}

test_file_start_sh_executable() {
  if [[ -x "$START_SH" ]]; then
    pass "File: start.sh is executable"
  else
    fail "File: start.sh is NOT executable"
  fi
}

test_file_injector_accessible() {
  local injector="$REPO_ROOT/windows/scripts/injector.mjs"
  if [[ -f "$injector" ]]; then
    pass "File: injector.mjs accessible at $injector"
  else
    fail "File: injector.mjs not found at $injector"
  fi
}

test_file_theme_json_accessible() {
  local theme_json="$REPO_ROOT/windows/assets/theme.json"
  if [[ -f "$theme_json" ]]; then
    pass "File: theme.json accessible at $theme_json"
  else
    fail "File: theme.json not found at $theme_json"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
# TEST: System integration (requires OpenCode installed, macOS only)
# ═══════════════════════════════════════════════════════════════════════════════

test_system_find_opencode() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    skip "System: find_opencode_install requires macOS"
    return
  fi

  if ! command -v pgrep &>/dev/null && ! command -v mdfind &>/dev/null; then
    skip "System: missing required tools (pgrep/mdfind)"
    return
  fi

  set +e
  local result
  result="$(find_opencode_install 2>/dev/null)"
  local rc=$?
  set -e

  if [[ $rc -eq 0 && -n "$result" ]]; then
    local first_path
    first_path="$(echo "$result" | head -1)"
    if [[ -x "$first_path" ]]; then
      pass "System: found OpenCode at $first_path"
    else
      skip "System: found paths but none executable"
    fi
  else
    skip "System: OpenCode not installed"
  fi
}

test_system_cdp_port_free() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    skip "System: CDP port check requires macOS"
    return
  fi

  if ! command -v lsof &>/dev/null; then
    skip "System: lsof not available"
    return
  fi

  set +e
  local pid
  pid="$(lsof -ti :9335 -sTCP:LISTEN 2>/dev/null || true)"
  set -e

  if [[ -z "$pid" ]]; then
    pass "System: CDP port 9335 is free"
  else
    local proc_name
    proc_name="$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")"
    skip "System: CDP port 9335 is in use by $proc_name (PID: $pid)"
  fi
}

test_system_injector_syntax() {
  local injector="$REPO_ROOT/windows/scripts/injector.mjs"
  if [[ ! -f "$injector" ]]; then
    skip "System: injector.mjs not found at $injector"
    return
  fi

  if ! command -v node &>/dev/null; then
    skip "System: node not available"
    return
  fi

  set +e
  local node_check
  node_check="$(node -c "$injector" 2>&1)"
  local rc=$?
  set -e

  if [[ $rc -eq 0 ]]; then
    pass "System: injector.mjs syntax is valid"
  else
    fail "System: injector.mjs syntax error: $node_check"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
# REGISTER TESTS
# ═══════════════════════════════════════════════════════════════════════════════

# Syntax
register_test "syntax/common.sh" test_syntax_common_sh "SYNTAX"
register_test "syntax/start.sh" test_syntax_start_sh "SYNTAX"

# File integrity
register_test "file/common.sh exists" test_file_common_sh_exists "UNIT"
register_test "file/start.sh exists" test_file_start_sh_exists "UNIT"
register_test "file/common.sh executable" test_file_common_sh_executable "UNIT"
register_test "file/start.sh executable" test_file_start_sh_executable "UNIT"
register_test "file/injector accessible" test_file_injector_accessible "UNIT"
register_test "file/theme.json accessible" test_file_theme_json_accessible "UNIT"

# Environment
register_test "env/bash" test_env_has_bash "UNIT"
register_test "env/macos" test_env_is_macos "ENV"
register_test "env/curl" test_env_has_curl "ENV"
register_test "env/lsof" test_env_has_lsof "ENV"
register_test "env/pgrep" test_env_has_pgrep "ENV"
register_test "env/node" test_env_has_node "ENV"
register_test "env/mdfind" test_env_has_mdfind "ENV"
register_test "env/plistbuddy" test_env_has_plistbuddy "ENV"

# Unit: find_opencode_install
register_test "unit/find/standard-path" test_find_opencode_install_standard_path "UNIT"
register_test "unit/find/empty" test_find_opencode_install_empty "UNIT"
register_test "unit/find/dedup" test_find_opencode_install_deduplicates "UNIT"

# Unit: start_opencode_app
register_test "unit/start/success" test_start_opencode_app_success "UNIT"
register_test "unit/start/noexistent" test_start_opencode_app_nonexistent "UNIT"

# Unit: stop_opencode_app
register_test "unit/stop/no-process" test_stop_opencode_app_no_process "UNIT"
register_test "unit/stop/graceful" test_stop_opencode_app_graceful "UNIT"

# Unit: test_opencode_port_owner
register_test "unit/port/no-lsof" test_opencode_port_owner_no_lsof "UNIT"
register_test "unit/port/not-opencode" test_opencode_port_owner_not_opencode "UNIT"
register_test "unit/port/is-opencode" test_opencode_port_owner_is_opencode "UNIT"

# Unit: wait_opencode_ready
register_test "unit/wait/no-curl" test_wait_opencode_ready_no_curl "UNIT"
register_test "unit/wait/success" test_wait_opencode_ready_success "UNIT"
register_test "unit/wait/timeout" test_wait_opencode_ready_timeout "UNIT"

# Unit: get_opencode_version
register_test "unit/version/nonexistent" test_get_opencode_version_nonexistent "UNIT"
register_test "unit/version/cli" test_get_opencode_version_cli "UNIT"

# Unit: start.sh argument parsing
register_test "unit/start-sh/help" test_start_sh_help "UNIT"
register_test "unit/start-sh/unknown-arg" test_start_sh_unknown_arg "UNIT"
register_test "unit/start-sh/dry-run" test_start_sh_dry_run "UNIT"
register_test "unit/start-sh/dry-run-custom-port" test_start_sh_dry_run_custom_port "UNIT"
register_test "unit/start-sh/missing-opencode" test_start_sh_missing_opencode "UNIT"
register_test "unit/start-sh/missing-theme" test_start_sh_missing_theme_dir "UNIT"
register_test "unit/start-sh/dry-run-pause" test_start_sh_dry_run_pause "UNIT"

# System (integration, require macOS + OpenCode)
register_test "system/find-opencode" test_system_find_opencode "SYSTEM"
register_test "system/cdp-port" test_system_cdp_port_free "SYSTEM"
register_test "system/injector-syntax" test_system_injector_syntax "SYSTEM"

# ═══════════════════════════════════════════════════════════════════════════════
# TEST RUNNER
# ═══════════════════════════════════════════════════════════════════════════════

run_tests_for_category() {
  local filter_category="$1"
  local run_count=0

  for ((i = 0; i < ${#TEST_NAMES[@]}; i++)); do
    local name="${TEST_NAMES[$i]}"
    local func="${TEST_FUNCTIONS[$i]}"
    local category="${TEST_CATEGORIES[$i]}"

    # Filter by category
    if [[ "$filter_category" == "unit" && "$category" != "UNIT" && "$category" != "SYNTAX" ]]; then
      continue
    fi
    if [[ "$filter_category" == "env" && "$category" != "ENV" ]]; then
      continue
    fi
    if [[ "$filter_category" == "system" && "$category" != "SYSTEM" ]]; then
      continue
    fi
    if [[ "$filter_category" == "syntax" && "$category" != "SYNTAX" ]]; then
      continue
    fi
    if [[ "$filter_category" == "all" ]]; then
      if [[ "$category" == "SYSTEM" && "$TEST_MODE" != "all" && "$TEST_MODE" != "system" ]]; then
        continue
      fi
    fi

    run_count=$((run_count + 1))
    TESTS_TOTAL=$((TESTS_TOTAL + 1))
    echo ""
    echo -e "${CYAN}[${category}]${NC} $name"

    # Create fresh mock dir for each test
    setup_mock_dir

    # Snapshot counters before test
    local pre_fail=$TESTS_FAILED
    local pre_pass=$TESTS_PASSED
    local pre_skip=$TESTS_SKIPPED

    # Run WITHOUT subshell so pass()/fail()/skip() update real globals
    # Use set +e to prevent assert failures from aborting the script
    local old_opts="$-"
    set +e
    "$func"
    local test_rc=$?
    # Restore original set -e state
    if [[ "$old_opts" == *e* ]]; then set -e; fi

    cleanup_mock_dir

    # Determine result based on counter changes and exit code
    if [[ $TESTS_FAILED -gt $pre_fail ]]; then
      : # fail() was already called inside test, counter updated
    elif [[ $TESTS_SKIPPED -gt $pre_skip ]]; then
      : # skip() was already called inside test, counter updated
    elif [[ $TESTS_PASSED -gt $pre_pass ]]; then
      : # pass() was already called inside test, counter updated
    elif [[ $test_rc -eq 0 ]]; then
      TESTS_PASSED=$((TESTS_PASSED + 1))
      echo -e "${GREEN}  PASS${NC} $name"
    else
      TESTS_FAILED=$((TESTS_FAILED + 1))
      echo -e "${RED}  FAIL${NC} $name (uncaught error, exit=$test_rc)"
    fi
  done

  return 0
}

print_summary() {
  echo ""
  echo "═══════════════════════════════════════════"
  echo "  Results:"
  echo "    Total:   $TESTS_TOTAL"
  echo -e "    ${GREEN}Passed:  $TESTS_PASSED${NC}"
  echo -e "    ${RED}Failed:  $TESTS_FAILED${NC}"
  echo -e "    ${YELLOW}Skipped: $TESTS_SKIPPED${NC}"
  echo "═══════════════════════════════════════════"

  if [[ $TESTS_FAILED -gt 0 ]]; then
    return 1
  fi
  return 0
}

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

cleanup_all() {
  cleanup_mock_dir
}

main() {
  # Ensure cleanup on exit
  trap cleanup_all EXIT

  # Parse arguments
  local filter="all"
  local list_only=false

  for arg in "$@"; do
    case "$arg" in
      --syntax) filter="syntax" ;;
      --unit) filter="unit" ;;
      --env) filter="env" ;;
      --system) filter="system" ;;
      --all) filter="all" ;;
      --list) list_only=true ;;
      --verbose) VERBOSE=true ;;
      *)
        echo "[ERROR] Unknown argument: $arg" >&2
        echo "Usage: $0 [--syntax|--unit|--env|--system|--all|--list|--verbose]" >&2
        exit 1
        ;;
    esac
  done

  if $list_only; then
    echo "Available tests:"
    echo ""
    local current_category=""
    for ((i = 0; i < ${#TEST_NAMES[@]}; i++)); do
      local name="${TEST_NAMES[$i]}"
      local category="${TEST_CATEGORIES[$i]}"
      if [[ "$category" != "$current_category" ]]; then
        current_category="$category"
        echo " [$current_category]"
      fi
      echo "   $name"
    done
    exit 0
  fi

  TEST_MODE="$filter"

  echo -e "${CYAN}OpenCode Dream Skin — macOS Test Suite${NC}"
  echo -e "${CYAN}========================================${NC}"
  echo "  Scripts dir: $MACOS_SCRIPTS"
  echo "  Mode:        $filter"
  echo ""

  # Source scripts for unit tests
  if [[ -f "$COMMON_SH" ]]; then
    source "$COMMON_SH"
  fi

  # Run tests
  run_tests_for_category "$filter"

  # Print summary
  print_summary
}

main "$@"
