#!/usr/bin/env bash

# init crontab silently if non-existent
crontab -l >/dev/null 2>&1 || crontab - <<'CRON'
CRON

command -v myria-node >/dev/null 2>&1 || {
  echo "myria-node command not found in PATH"
  exit 1
}

echo -n "How many nodes do you want to schedule (2-3)? "
read -r node_count

if ! [[ "$node_count" =~ ^[0-9]+$ ]]; then
  echo "Please enter a number."
  exit 1
fi

if (( node_count < 2 )); then
  echo "no need for a scheduler with just one node ;)"
  exit 0
fi

if (( node_count > 3 )); then
  echo "you need to run each node for 6 hours for max rewards, therefore you cannot run more than 3 on a single server"
  echo "4 nodes won't work since downtime for stopping and starting has to be included"
  exit 1
fi

echo -n "Enter your first API key: "
read -r api_1

echo -n "Enter your second API key: "
read -r api_2

if (( node_count > 2 )); then
  echo -n "Enter your third API key: "
  read -r api_3
fi

new_jobs=""

if (( node_count == 2 )); then
  new_jobs+="0 2 * * * printf '%s\\n' '$api_2' | myria-node --stop"$'\n'
  new_jobs+="5 2 * * * printf '%s\\n' '$api_1' | myria-node --start"$'\n'
  new_jobs+="0 14 * * * printf '%s\\n' '$api_1' | myria-node --stop"$'\n'
  new_jobs+="5 14 * * * printf '%s\\n' '$api_2' | myria-node --start"$'\n'
fi

if (( node_count == 3 )); then
  new_jobs+="0 2 * * * printf '%s\\n' '$api_3' | myria-node --stop"$'\n'
  new_jobs+="5 2 * * * printf '%s\\n' '$api_1' | myria-node --start"$'\n'
  new_jobs+="0 10 * * * printf '%s\\n' '$api_1' | myria-node --stop"$'\n'
  new_jobs+="5 10 * * * printf '%s\\n' '$api_2' | myria-node --start"$'\n'
  new_jobs+="0 18 * * * printf '%s\\n' '$api_2' | myria-node --stop"$'\n'
  new_jobs+="5 18 * * * printf '%s\\n' '$api_3' | myria-node --start"$'\n'
fi

# Keep existing cron jobs and append scheduler lines in one install.
{ crontab -l 2>/dev/null; printf "%s" "$new_jobs"; } | sed '/^[[:space:]]*$/d' | crontab -

echo "Scheduler installed."
echo "Current crontab:"
crontab -l
