#!/usr/bin/env bash
set -euo pipefail

TAG="# MYRIA-SCHEDULER"
CONFIG_FILE="${HOME}/.myria-scheduler.conf"
LOG_FILE="${HOME}/.myria-scheduler.log"
MYRIA_BIN="/usr/local/bin/myria-node"
EXPECT_BIN="/usr/bin/expect"

script_path() {
  cd "$(dirname "$0")" && pwd
  printf "%s/%s\n" "$PWD" "$(basename "$0")"
}

die() {
  printf "ERROR: %s\n" "$*" >&2
  exit 1
}

require_bins() {
  [[ -x "$MYRIA_BIN" ]] || die "Myria binary not found at $MYRIA_BIN"
  [[ -x "$EXPECT_BIN" ]] || die "Expect binary not found at $EXPECT_BIN"
  command -v crontab >/dev/null 2>&1 || die "crontab command not available"
}

is_int() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

run_myria_action() {
  local action="$1"
  local api_key="$2"

  [[ "$action" == "start" || "$action" == "stop" ]] || die "Invalid action: $action"

  ACTION="$action" API_KEY="$api_key" MYRIA_BIN="$MYRIA_BIN" "$EXPECT_BIN" <<'EXP'
set timeout 120
spawn $env(MYRIA_BIN) --$env(ACTION)
expect {
  -re {Enter the node API Key:} { send -- "$env(API_KEY)\r" }
  timeout { puts "Timed out waiting for API key prompt"; exit 1 }
}
expect eof
set status [lindex [wait] 3]
exit $status
EXP
}

load_config() {
  [[ -f "$CONFIG_FILE" ]] || die "Config not found: $CONFIG_FILE. Run setup first."
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"

  is_int "${NODE_COUNT:-}" || die "NODE_COUNT missing/invalid in config"
  (( NODE_COUNT >= 2 && NODE_COUNT <= 3 )) || die "NODE_COUNT must be 2 or 3"

  local i
  for (( i=1; i<=NODE_COUNT; i++ )); do
    local var="API_KEY_${i}"
    [[ -n "${!var:-}" ]] || die "$var missing in config"
  done
}

write_config() {
  local node_count="$1"
  shift
  local -a keys=("$@")

  umask 077
  {
    printf "NODE_COUNT=%q\n" "$node_count"
    local i
    for (( i=1; i<=node_count; i++ )); do
      printf "API_KEY_%d=%q\n" "$i" "${keys[$((i-1))]}"
    done
  } > "$CONFIG_FILE"
}

build_schedule_lines() {
  local node_count="$1"
  local self_path
  self_path="$(script_path)"
  local cron_env
  cron_env='PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

  if (( node_count == 2 )); then
    cat <<CRON
0 2 * * * $cron_env /bin/bash "$self_path" --action stop 2 >> "$LOG_FILE" 2>&1 $TAG
5 2 * * * $cron_env /bin/bash "$self_path" --action start 1 >> "$LOG_FILE" 2>&1 $TAG
0 14 * * * $cron_env /bin/bash "$self_path" --action stop 1 >> "$LOG_FILE" 2>&1 $TAG
5 14 * * * $cron_env /bin/bash "$self_path" --action start 2 >> "$LOG_FILE" 2>&1 $TAG
CRON
    return
  fi

  cat <<CRON
0 2 * * * $cron_env /bin/bash "$self_path" --action stop 3 >> "$LOG_FILE" 2>&1 $TAG
5 2 * * * $cron_env /bin/bash "$self_path" --action start 1 >> "$LOG_FILE" 2>&1 $TAG
0 10 * * * $cron_env /bin/bash "$self_path" --action stop 1 >> "$LOG_FILE" 2>&1 $TAG
5 10 * * * $cron_env /bin/bash "$self_path" --action start 2 >> "$LOG_FILE" 2>&1 $TAG
0 18 * * * $cron_env /bin/bash "$self_path" --action stop 2 >> "$LOG_FILE" 2>&1 $TAG
5 18 * * * $cron_env /bin/bash "$self_path" --action start 3 >> "$LOG_FILE" 2>&1 $TAG
CRON
}

install_cron() {
  local schedule="$1"
  local existing
  existing="$(crontab -l 2>/dev/null | grep -vF "$TAG" || true)"

  {
    [[ -n "$existing" ]] && printf "%s\n" "$existing"
    printf "%s\n" "$schedule"
  } | sed '/^[[:space:]]*$/d' | crontab -
}

setup_scheduler() {
  require_bins

  local node_count
  while true; do
    read -r -p "How many nodes do you want to schedule (2-3)? " node_count
    if is_int "$node_count" && (( node_count >= 2 && node_count <= 3 )); then
      break
    fi
    echo "Please enter 2 or 3."
  done

  local -a keys=()
  local i
  for (( i=1; i<=node_count; i++ )); do
    local key
    while true; do
      read -r -p "Enter API key for node $i: " key
      if [[ -n "$key" ]]; then
        keys+=("$key")
        break
      fi
      echo "API key cannot be empty."
    done
  done

  write_config "$node_count" "${keys[@]}"
  local schedule
  schedule="$(build_schedule_lines "$node_count")"
  install_cron "$schedule"

  echo "Scheduler installed."
  echo "Config: $CONFIG_FILE"
  echo "Log: $LOG_FILE"
  echo "Managed cron entries:"
  crontab -l | grep -F "$TAG" || true
}

run_action_mode() {
  require_bins
  load_config

  local action="$1"
  local idx="$2"

  is_int "$idx" || die "Node index must be numeric"
  (( idx >= 1 && idx <= NODE_COUNT )) || die "Node index out of range (1-${NODE_COUNT})"

  local var="API_KEY_${idx}"
  local key="${!var}"

  printf "[%s] %s node %s\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$action" "$idx"
  run_myria_action "$action" "$key"
  printf "[%s] %s node %s complete\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$action" "$idx"
}

clear_managed_cron() {
  local existing
  existing="$(crontab -l 2>/dev/null | grep -vF "$TAG" || true)"
  [[ -n "$existing" ]] && printf "%s\n" "$existing" | crontab - || crontab -r 2>/dev/null || true
  echo "Removed managed Myria scheduler cron entries."
}

usage() {
  cat <<USAGE
Usage:
  bash schedule-node.sh                    # interactive setup and cron install
  bash schedule-node.sh --action start N   # start node N from saved config
  bash schedule-node.sh --action stop N    # stop node N from saved config
  bash schedule-node.sh --clear-cron       # remove managed cron lines
USAGE
}

main() {
  if (( $# == 0 )); then
    setup_scheduler
    return
  fi

  case "$1" in
    --action)
      [[ $# -eq 3 ]] || die "--action requires: start|stop and node index"
      run_action_mode "$2" "$3"
      ;;
    --clear-cron)
      clear_managed_cron
      ;;
    -h|--help)
      usage
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
