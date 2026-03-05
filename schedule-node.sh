#!/usr/bin/env bash

# init crontab silently if non-existent
crontab -l >/dev/null 2>&1 || crontab - <<'CRON'
CRON

echo -n "How many nodes do you want to schedule (2-3)? "
read -r node_count

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

echo -n "Which node is currently running right now (1-${node_count})? "
read -r active_node

if (( active_node < 1 || active_node > node_count )); then
    echo "Invalid running node: ${active_node}. Expected a number from 1 to ${node_count}."
    exit 1
fi

# Preserve any existing non-myria cron jobs and replace only managed entries.
existing_cron="$(crontab -l 2>/dev/null | grep -v '# MYRIA-SCHEDULER' || true)"

if (( node_count == 2 )); then
    case "$active_node" in
        1)
            stop_1="$api_1"; start_1="$api_2"
            stop_2="$api_2"; start_2="$api_1"
            ;;
        2)
            stop_1="$api_2"; start_1="$api_1"
            stop_2="$api_1"; start_2="$api_2"
            ;;
    esac

    new_jobs=$(cat <<CRON
0 2 * * * echo "$stop_1" | myria-node --stop # MYRIA-SCHEDULER
5 2 * * * echo "$start_1" | myria-node --start # MYRIA-SCHEDULER
0 14 * * * echo "$stop_2" | myria-node --stop # MYRIA-SCHEDULER
5 14 * * * echo "$start_2" | myria-node --start # MYRIA-SCHEDULER
CRON
)
fi

if (( node_count == 3 )); then
    case "$active_node" in
        1)
            stop_1="$api_1"; start_1="$api_2"
            stop_2="$api_2"; start_2="$api_3"
            stop_3="$api_3"; start_3="$api_1"
            ;;
        2)
            stop_1="$api_2"; start_1="$api_3"
            stop_2="$api_3"; start_2="$api_1"
            stop_3="$api_1"; start_3="$api_2"
            ;;
        3)
            stop_1="$api_3"; start_1="$api_1"
            stop_2="$api_1"; start_2="$api_2"
            stop_3="$api_2"; start_3="$api_3"
            ;;
    esac

    new_jobs=$(cat <<CRON
0 2 * * * echo "$stop_1" | myria-node --stop # MYRIA-SCHEDULER
5 2 * * * echo "$start_1" | myria-node --start # MYRIA-SCHEDULER
0 10 * * * echo "$stop_2" | myria-node --stop # MYRIA-SCHEDULER
5 10 * * * echo "$start_2" | myria-node --start # MYRIA-SCHEDULER
0 18 * * * echo "$stop_3" | myria-node --stop # MYRIA-SCHEDULER
5 18 * * * echo "$start_3" | myria-node --start # MYRIA-SCHEDULER
CRON
)
fi

{ printf "%s\n" "$existing_cron"; printf "%s\n" "$new_jobs"; } | sed '/^[[:space:]]*$/d' | crontab -

echo "Myria scheduler installed."
echo "Current managed entries:"
crontab -l | grep 'MYRIA-SCHEDULER' || true
