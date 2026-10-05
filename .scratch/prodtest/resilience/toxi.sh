#!/usr/bin/env bash
# Drill 7: a slow or dead network between api and db, through toxiproxy (toxi.override.yaml).
#   toxi.sh <env file> <out dir> setup|phase <name> <seconds> [toxic json]|clear
# A phase adds the toxic (both directions), samples the api's MySQL connections and /api/health
# every 5 s, then removes it. Marks go to <out>/drills.log under the drill name "toxi-<name>".
set -u
ENV=$1 OUT=$2 CMD=$3
P=ta-res
HERE=$(cd "$(dirname "$0")" && pwd)
dc() { docker compose -p "$P" --env-file "$ENV" -f "$HERE/../../../compose.yaml" -f "$HERE/toxi.override.yaml" "$@"; }
T=http://127.0.0.1:18474
now() { date -u +%Y-%m-%dT%H:%M:%S.%3NZ; }
ms() { date +%s%3N; }
mark() { echo "$(now) $(ms) $DRILL $*" | tee -a "$OUT/drills.log"; }
conns() {
  docker exec $P-db-1 sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -e "SELECT COUNT(*), SUM(command <> '"'"'Sleep'"'"'), MAX(time) FROM information_schema.processlist WHERE user = '"'"'temperature'"'"'"' 2>/dev/null | tr '\t' ' '
}
sample() {
  local h; h=$(curl -s -o /dev/null -w '%{http_code}/%{time_total}' --max-time 15 http://127.0.0.1:8096/api/health)
  local mem; mem=$(docker stats --no-stream --format '{{.MemUsage}}' $P-api-1 | cut -d/ -f1)
  mark "sample health=$h api_mysql_conns(total busy maxtime)=$(conns) api_mem=$mem"
}

case $CMD in
  setup)
    DRILL=toxi-setup
    mark begin
    dc up -d toxi 2>&1 | tail -1
    sleep 2
    curl -s -X POST $T/proxies -d '{"name":"mysql","listen":"0.0.0.0:13306","upstream":"db:3306"}'; echo
    dc up -d --wait api 2>&1 | tail -1
    mark "api now reaches db through toxi"
    sample
    mark end ;;
  phase)
    NAME=$4 SECS=$5 TOXIC=$6
    DRILL=toxi-$NAME
    mark begin
    sample
    for stream in downstream upstream; do
      curl -s -X POST $T/proxies/mysql/toxics -d "$(echo "$TOXIC" | sed "s/\"stream\":\"[a-z]*\"/\"stream\":\"$stream\"/; s/\"name\":\"[a-z_]*\"/\"name\":\"t_$stream\"/")" >/dev/null
    done
    mark "toxic on: $TOXIC"
    end=$(( $(ms) + SECS * 1000 ))
    while [ "$(ms)" -lt "$end" ]; do sample; sleep 4; done
    for stream in downstream upstream; do curl -s -X DELETE $T/proxies/mysql/toxics/t_$stream >/dev/null; done
    mark "toxic off"
    t0=$(ms)
    for i in $(seq 1 24); do sample; case $(tail -1 "$OUT/drills.log") in *health=200/*) mark "health 200 again after $(( $(ms) - t0 )) ms"; break ;; esac; sleep 4; done
    sleep 20; sample
    mark end ;;
  clear)
    DRILL=toxi-clear
    mark begin
    curl -s $T/proxies/mysql/toxics; echo
    mark end ;;
esac
