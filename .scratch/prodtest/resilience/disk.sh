#!/usr/bin/env bash
# Drill 5: the database volume fills up. The db runs on a 700 MB tmpfs (disk.override.yaml); a
# filler file takes all but LEAVE_MB of it for HOLD seconds, then is deleted.
#   disk.sh <out dir> <hold seconds> [leave MB]
set -u
OUT=$1 HOLD=$2 LEAVE=${3:-1}
P=ta-res DRILL=disk-full
export MSYS_NO_PATHCONV=1
now() { date -u +%Y-%m-%dT%H:%M:%S.%3NZ; }
ms() { date +%s%3N; }
mark() { echo "$(now) $(ms) $DRILL $*" | tee -a "$OUT/drills.log"; }
state() { docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}/restarts={{.RestartCount}}' "$P-$1-1" 2>/dev/null || echo absent; }
sample() {
  local h; h=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8096/api/health)
  local free; free=$(docker exec $P-db-1 df -m /var/lib/mysql 2>/dev/null | awk 'NR==2{print $4}')
  mark "sample db=$(state db) api=$(state api) health=$h free_mb=${free:-?}"
}
mark begin
sample
avail=$(docker exec $P-db-1 df -m /var/lib/mysql | awk 'NR==2{print $4}')
mark "filling $((avail - LEAVE)) MB of $avail MB free"
if [ "$LEAVE" = 0 ]; then docker exec -u root $P-db-1 dd if=/dev/zero of=/var/lib/mysql/zz-filler bs=64k 2>&1 | tail -1; else docker exec -u root $P-db-1 dd if=/dev/zero of=/var/lib/mysql/zz-filler bs=1M count=$((avail - LEAVE)) 2>&1 | tail -1; fi
sample
end=$(( $(ms) + HOLD * 1000 ))
while [ "$(ms)" -lt "$end" ]; do sleep 5; sample; done
docker logs --since "${HOLD}s" $P-db-1 > "$OUT/db-during-full.log" 2>&1
mark "deleting the filler"
# The db may be down (restarting) by now, so delete through a throwaway container on the same volume.
if ! docker exec -u root $P-db-1 rm -f /var/lib/mysql/zz-filler 2>/dev/null; then
  mark "db container not running; deleting through a helper container"
  docker run --rm --volumes-from $P-db-1 alpine:3.20 rm -f /var/lib/mysql/zz-filler
fi
t0=$(ms)
for i in $(seq 1 60); do
  sample
  case $(tail -1 "$OUT/drills.log") in *health=200*db=running/healthy*|*db=running/healthy*health=200*) mark "recovered $(( $(ms) - t0 )) ms after the space came back"; break ;; esac
  sleep 3
done
sleep 30; sample
mark end
