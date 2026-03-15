#!/usr/bin/env bash

set -euo pipefail

readonly MARKER_START="# >>> myria-node-scheduler >>>"
readonly MARKER_END="# <<< myria-node-scheduler <<<"
readonly LOG_FILE="$HOME/.myria-node-scheduler.log"

shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\"'\"'/g")"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1"
    exit 1
  fi
}

require_command crontab

myria_node_bin="$(type -P myria-node || true)"
if [[ -z "$myria_node_bin" ]]; then
  echo "myria-node executable not found in PATH."
  echo "Install it first, then run this scheduler script again."
  exit 1
fi

if command -v systemctl >/dev/null 2>&1; then
  if ! systemctl is-active --quiet cron && ! systemctl is-active --quiet crond; then
    echo "Warning: cron service does not appear active. Jobs may never run."
    echo "Try: sudo systemctl enable --now cron   (or crond on your distro)"
  fi
fi

echo -n "How many nodes do you want to schedule (2-3)? "
read -r node_count

if ! [[ "$node_count" =~ ^[0-9]+$ ]]; then
  echo "Please enter a number."
  exit 1
fi

if (( node_count < 2 || node_count > 3 )); then
  echo "This scheduler supports only 2 or 3 nodes."
  echo "Each node must run for at least 6 hours, so 4+ nodes on one VPS is not supported."
  exit 1
fi

echo -n "Enter your first API key: "
read -r api_1
echo -n "Enter your second API key: "
read -r api_2

api_3=""
if (( node_count == 3 )); then
  echo -n "Enter your third API key: "
  read -r api_3
fi

api_1_q="$(shell_quote "$api_1")"
api_2_q="$(shell_quote "$api_2")"
api_3_q="$(shell_quote "$api_3")"
myria_node_bin_q="$(shell_quote "$myria_node_bin")"
log_file_q="$(shell_quote "$LOG_FILE")"

cron_jobs=""
if (( node_count == 2 )); then
  cron_jobs+="0 2 * * * /bin/echo ${api_2_q} | ${myria_node_bin_q} --stop >> ${log_file_q} 2>&1"$'\n'
  cron_jobs+="5 2 * * * /bin/echo ${api_1_q} | ${myria_node_bin_q} --start >> ${log_file_q} 2>&1"$'\n'
  cron_jobs+="0 14 * * * /bin/echo ${api_1_q} | ${myria_node_bin_q} --stop >> ${log_file_q} 2>&1"$'\n'
  cron_jobs+="5 14 * * * /bin/echo ${api_2_q} | ${myria_node_bin_q} --start >> ${log_file_q} 2>&1"$'\n'
else
  cron_jobs+="0 2 * * * /bin/echo ${api_3_q} | ${myria_node_bin_q} --stop >> ${log_file_q} 2>&1"$'\n'
  cron_jobs+="5 2 * * * /bin/echo ${api_1_q} | ${myria_node_bin_q} --start >> ${log_file_q} 2>&1"$'\n'
  cron_jobs+="0 10 * * * /bin/echo ${api_1_q} | ${myria_node_bin_q} --stop >> ${log_file_q} 2>&1"$'\n'
  cron_jobs+="5 10 * * * /bin/echo ${api_2_q} | ${myria_node_bin_q} --start >> ${log_file_q} 2>&1"$'\n'
  cron_jobs+="0 18 * * * /bin/echo ${api_2_q} | ${myria_node_bin_q} --stop >> ${log_file_q} 2>&1"$'\n'
  cron_jobs+="5 18 * * * /bin/echo ${api_3_q} | ${myria_node_bin_q} --start >> ${log_file_q} 2>&1"$'\n'
fi

existing_cron="$(crontab -l 2>/dev/null || true)"
cleaned_cron="$(printf '%s\n' "$existing_cron" | awk -v s="$MARKER_START" -v e="$MARKER_END" '
  $0 == s { drop=1; next }
  $0 == e { drop=0; next }
  !drop { print }
')"

{
  printf '%s\n' "$cleaned_cron"
  printf '%s\n' "$MARKER_START"
  printf '%s' "$cron_jobs"
  printf '%s\n' "$MARKER_END"
} | sed '/^[[:space:]]*$/d' | crontab -

echo "Scheduler installed."
echo "myria-node path: $myria_node_bin"
echo "Cron log file: $LOG_FILE"
echo "Current crontab:"
crontab -l
