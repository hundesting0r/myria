# Myria Node Scheduler (Linux VPS)

Run 2 or 3 Myria nodes on one VPS by rotating API keys on a fixed schedule.

This scheduler uses cron + `myria-node`:
- 2-node rotation: switch every 12 hours
- 3-node rotation: switch every 8 hours

Each node gets at least 6 hours runtime per 24h cycle.

## Schedule

All times are in your VPS local timezone.

### 3 nodes
- `02:00` stop node3
- `02:05` start node1
- `10:00` stop node1
- `10:05` start node2
- `18:00` stop node2
- `18:05` start node3

### 2 nodes
- `02:00` stop node2
- `02:05` start node1
- `14:00` stop node1
- `14:05` start node2

## Fresh Install (Ubuntu/Debian)

Run as `root`.

### 1) Install base tools and cron

```bash
apt update
apt install -y curl ca-certificates cron
systemctl enable --now cron
```

### 2) Install `myria-node` first

Install Myria headless node with the official method, then verify:

```bash
command -v myria-node
systemctl status myria-node --no-pager -l || true
```

### 3) Apply compatibility patch to older `myria-node` builds

Some older builds use a broken curl flag combination.

```bash
grep -q "curl -sb --location" /usr/local/bin/myria-node && \
sed -i 's/curl -sb --location/curl -sS --location/g' /usr/local/bin/myria-node || true
```

### 4) Download and run scheduler installer

```bash
cd /root
curl -fsSL https://raw.githubusercontent.com/hundesting0r/myria/main/schedule-node.sh -o schedule-node.sh
chmod +x schedule-node.sh
./schedule-node.sh
```

When prompted, enter:
- node count (`2` or `3`)
- API keys in rotation order (`node1`, `node2`, optional `node3`)

### 5) Bootstrap current slot once

The scheduler does not immediately start a node when installed. Start the node that should currently be active:
- 3 nodes: `02:05-10:00 node1`, `10:05-18:00 node2`, `18:05-02:00 node3`
- 2 nodes: `02:05-14:00 node1`, `14:05-02:00 node2`

Example:

```bash
printf '%s\n' 'YOUR_API_KEY' | myria-node --start
```

## Verify

### Check installed cron jobs

```bash
crontab -l
```

### Check scheduler log

```bash
tail -f /root/.myria-node-scheduler.log
```

### Check node service

```bash
systemctl status myria-node --no-pager -l
myria-node --status
```

## Reinstall / Update Scheduler

Re-run installer anytime to replace only the managed scheduler block:

```bash
cd /root
curl -fsSL https://raw.githubusercontent.com/hundesting0r/myria/main/schedule-node.sh -o schedule-node.sh
chmod +x schedule-node.sh
./schedule-node.sh
```

## Troubleshooting

### No rotation happens

1. Confirm cron is active:
```bash
systemctl is-active cron
```
2. Confirm scheduler jobs exist:
```bash
crontab -l
```
3. Confirm no old broken cron format remains:
```bash
crontab -l | grep "printf '%s\\\\n'" && echo "Old format still installed"
```
4. Check scheduler log:
```bash
tail -n 200 /root/.myria-node-scheduler.log
```

### `myria-node` API errors

Verify the patch in step 3 is applied:

```bash
grep -n "curl -sS --location" /usr/local/bin/myria-node
```

### Service does not run

```bash
systemctl status myria-node --no-pager -l
journalctl -u myria-node -n 200 --no-pager
```

## Security Notes

- API keys are stored in root crontab entries.
- Anyone with root access can read them.
- If a key is ever exposed (terminal output, screenshots, chat), rotate it immediately.
