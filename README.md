Yes, `schedule-node.sh` is updated and ready to upload.

One important distinction:
- `schedule-node.sh` contains the scheduler fixes.
- The `myria-node` patch (`curl -sb` -> `curl -sS`) is a separate change on the VPS at `/usr/local/bin/myria-node`, not inside `schedule-node.sh`.

So upload `schedule-node.sh` now, and also make sure your VPS install process reapplies this one-liner after installing `myria-node`:

```bash
sed -i 's/curl -sb --location/curl -sS --location/g' /usr/local/bin/myria-node
```
