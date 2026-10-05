#!/usr/bin/env bash
# Failure drills 1-4 against the ta-res stack while fleet.mjs and chrome.mjs run.
#   drills.sh <env file> <out dir> api-kill|db-kill|web-restart|stack-restart|down-up [hold seconds]
# Every step is timestamped into <out>/drills.log; health is polled every 0.5 s so recovery is
# measured from the drill's first action to the moment the stack answers /api/health through web.
set -u
ENV=$1 OUT=$2 DRILL=$3 HOLD=${4:-0}
P=ta-res
BASE=http://127.0.0.1:8096
dc() { docker compose -p "$P" --env-file "$ENV" -f "$(dirname "$0")/../../../compose.yaml" "$@"; }
now() { date -u +%Y-%m-%dT%H:%M:%S.%3NZ; }
ms() { date +%s%3N; }
mark() { echo "$(now) $(ms) $DRILL $*" | tee -a "$OUT/drills.log"; }
state() { docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{end}}/restarts={{.RestartCount}}' "$P-$1-1" 2>/dev/null || echo absent; }
health() { curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/api/health"; }

# Poll until /api/health through web answers 200, logging each change of the containers' states.
wait_recovered() {
  local t0=$1 last="" limit=${2:-600}
  while :; do
    local s="api=$(state api) db=$(state db) web=$(state web) health=$(health)"
    [ "$s" != "$last" ] && mark "state $s"
    last=$s
    case $s in *health=200*) mark "recovered after $(( $(ms) - t0 )) ms"; return 0 ;; esac
    if [ $(( $(ms) - t0 )) -gt $(( limit * 1000 )) ]; then mark "NOT recovered after ${limit}s"; return 1; fi
    sleep 0.5
  done
}

# Watch states for a fixed time (to see crash loops and healthcheck transitions).
watch_for() {
  local until=$(( $(ms) + $1 * 1000 )) last=""
  while [ "$(ms)" -lt "$until" ]; do
    local s="api=$(state api) db=$(state db) web=$(state web) health=$(health)"
    [ "$s" != "$last" ] && mark "state $s"
    last=$s
    sleep 0.5
  done
}

mark "begin"
case $DRILL in
  api-kill)
    t0=$(ms); mark "docker kill api"; docker kill "$P-api-1" >/dev/null
    watch_for 5
    case $(state api) in exited*) mark "api not restarted by policy after docker kill; docker start api"; docker start "$P-api-1" >/dev/null ;; esac
    wait_recovered "$t0" ;;
  api-crash|db-crash)
    # A real crash: SIGKILL to the service's main process from the VM's PID namespace, which the
    # restart policy treats as a failure (docker kill counts as a manual stop and is not restarted).
    svc=${DRILL%-crash}
    pid=$(docker inspect -f '{{.State.Pid}}' "$P-$svc-1")
    t0=$(ms); mark "SIGKILL $svc main process (host pid $pid)"
    docker run --rm --privileged --pid=host alpine:3.20 kill -9 "$pid"
    wait_recovered "$t0" ;;
  db-kill)
    t0=$(ms); mark "docker kill db"; docker kill "$P-db-1" >/dev/null
    watch_for "${HOLD:-5}"
    case $(state db) in exited*) mark "db not restarted by policy after docker kill; docker start db"; docker start "$P-db-1" >/dev/null ;; esac
    wait_recovered "$t0" ;;
  db-stop-long)
    # The db away for HOLD seconds (an outage longer than the api healthcheck's 50 s budget).
    t0=$(ms); mark "docker stop db for ${HOLD}s"; docker stop -t 2 "$P-db-1" >/dev/null
    watch_for "$HOLD"
    mark "docker start db"; docker start "$P-db-1" >/dev/null
    wait_recovered "$t0" ;;
  web-restart)
    t0=$(ms); mark "compose restart web"; dc restart web 2>&1 | tail -1
    wait_recovered "$t0" ;;
  stack-restart)
    t0=$(ms); mark "compose restart"; dc restart 2>&1 | tail -1
    wait_recovered "$t0" ;;
  down-up)
    t0=$(ms); mark "compose down (no -v)"; dc down 2>&1 | tail -1
    mark "down; holding ${HOLD}s"; sleep "$HOLD"
    mark "compose up -d --wait"; dc up -d --wait 2>&1 | tail -1
    wait_recovered "$t0" ;;
esac
watch_for 5
mark "end"
