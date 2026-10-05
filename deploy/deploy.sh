#!/usr/bin/env bash
# Install, deploy, upgrade, back up, and remove the Temperature Alarms stack (compose.yaml)
# on this server, or on remote servers over ssh. Run with no action for a menu; every action
# also runs non-interactively with --yes. `deploy/deploy.sh --help` lists them.
#
# Works with bash 3.2 (macOS) and later, Git Bash on Windows, and a bare ssh session: plain
# prompts on stdin, colour only when stdout is a terminal. Every action is safe to repeat.
# deploy/deploy.ps1 is the same tool for Windows PowerShell.

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
SCRIPT_PATH="$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")"
ENV_FILE=".env"
BACKUP_DIR="backups"
DB_NAME="temperature_alarms"
SECRETS="ADMIN_TOKEN DEVICE_TOKEN DB_PASSWORD"
TUNABLES="REPORT_INTERVAL_SECONDS RETENTION_DAYS HOT_WARNING_F HOT_CRITICAL_F COLD_WARNING_F DRY_WARNING_PERCENT MISSED_REPORTS_BEFORE_OFFLINE LEGACY_TIME_ZONE"
# The demo (compose.demo.yaml) has its own project, so its own volume, and throwaway secrets.
DEMO_PROJECT="temperature-alarms-demo"
DEMO_ENV=".env.demo"
DEMO_PORT="8080"

# Git Bash would rewrite arguments that look like paths before docker sees them.
export MSYS_NO_PATHCONV=1
# Without build attestations an unchanged checkout rebuilds to the same image id, so a
# repeated deploy leaves the running containers alone instead of recreating them.
export BUILDX_NO_DEFAULT_ATTESTATIONS="${BUILDX_NO_DEFAULT_ATTESTATIONS:-1}"

# --- options ---------------------------------------------------------------------------
ACTION=""
FILE=""
YES=0
PROJECT=""
WEB_PORT_OPT=""
SETS=()
PULL=""
REVEAL=0
RECONFIGURE=0
WIPE=0
CONFIRM=""
FOLLOW=0
TAIL=200
SERVICE=""
KEEP_DAYS=""
AT="02:00"
BOOTSTRAP=0
DOWN=0
DC_ARGS=()
HOSTS=()
SERVERS_FILE=""
REMOTE_DIR="temperature-alarms"
REPO_URL=""
BRANCH=""
SSH_OPTS="${DEPLOY_SSH_OPTS:-}"
PASS_ARGS=()
ORIG_ARGS=("$@")

# --- output ----------------------------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[31m' C_GREEN=$'\033[32m' C_YELLOW=$'\033[33m' C_BOLD=$'\033[1m' C_DIM=$'\033[2m' C_OFF=$'\033[0m'
else
  C_RED="" C_GREEN="" C_YELLOW="" C_BOLD="" C_DIM="" C_OFF=""
fi

say()  { printf '%s\n' "$*"; }
step() { printf '\n%s==> %s%s\n' "$C_BOLD" "$*" "$C_OFF"; }
ok()   { printf '  %s[ ok ]%s %s\n' "$C_GREEN" "$C_OFF" "$*"; }
warn() { printf '  %s[warn]%s %s\n' "$C_YELLOW" "$C_OFF" "$*"; }
bad()  { printf '  %s[FAIL]%s %s\n' "$C_RED" "$C_OFF" "$*"; }
die()  { printf '%sError:%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: deploy/deploy.sh [action] [options]

With no action and a terminal, shows a menu. Actions:
  bootstrap          Prepare a fresh Linux server: Docker Engine and Compose from Docker's own
                     apt/dnf repository, git, and cron; start Docker and add you to the docker
                     group (log in again after). Ubuntu, Debian, RHEL, Rocky, Alma, CentOS
                     Stream, Fedora. Uses sudo when not root. Skips what is already there.
  preflight          Check Docker, Compose v2, the daemon, the web port, and disk space
  install            Create .env from .env.example with generated secrets (keeps an existing one)
  deploy             Install if needed, optionally git pull, build and start, wait for healthy,
                     check /api/health through web. Also the upgrade. Safe to repeat.
  status             Containers and the health check
  logs               Recent logs (--follow, --service api|web|db, --tail N)
  backup             mysqldump to backups/<project>_<time>.sql.gz (--keep-days N prunes older ones)
  schedule-backup    Run backup nightly from cron (--at HH:MM, default 02:00; --keep-days N,
                     default 7). Replaces its own crontab line; other lines are left alone.
  unschedule-backup  Remove that crontab line
  restore [FILE]     Replace the database with a backup (typed confirmation; backs up first)
  migrate-legacy     Back up, then run `npm run migrate:legacy` in api
  info               The URL, the tokens (masked unless --reveal), and the config.h lines
  stop               Stop the containers; data and settings stay
  uninstall          Remove containers and built images; --wipe also deletes the database
                     (typed confirmation). .env and backups/ stay.
  demo               See it without hardware: the stack plus sample Campuses, Devices, a week
                     of history, and live Readings that loop through every Condition. Its own
                     project (temperature-alarms-demo) and throwaway secrets in .env.demo, so
                     it never touches a real install. --web-port (default 8080); --down
                     removes it, volume and .env.demo included.

Options:
  -y, --yes             Non-interactive: take flag values and defaults, never prompt
  -p, --project NAME    Compose project name; default is Compose's own (the folder name), which
                        names the database volume, so keep it for an existing install
      --web-port PORT   The published port, or ADDR:PORT (install, deploy)
      --set KEY=VALUE   A tunable from .env.example (repeatable; install, deploy)
      --reconfigure     Apply --web-port/--set to an existing .env (secrets are kept)
      --pull / --no-pull  git pull --ff-only before deploy (asked when interactive)
      --reveal          Print tokens in full (info)
      --confirm TEXT    Answer a typed confirmation non-interactively: the project name
      --wipe            uninstall also deletes the database volume
      --down            demo: remove the demo instead of starting it
      --file FILE       Backup file for restore
      --keep-days N     backup and schedule-backup: delete this project's backups older than N days
      --at HH:MM        schedule-backup: the time of day (default 02:00)
      --follow, --service NAME, --tail N   For logs
Remote (runs this script on each server over ssh; each keeps its own .env and backups):
      --host USER@SERVER  Repeatable
      --servers FILE      One USER@SERVER per line, # comments (e.g. deploy/servers.txt)
      --dir PATH          Checkout on the server (default: temperature-alarms, under $HOME)
      --repo URL          Repo to clone there (default: this checkout's origin)
      --branch NAME       Branch to clone
      --ssh-opts "OPTS"   Extra ssh options, e.g. "-p 2222 -i ~/.ssh/id_ed25519" (or DEPLOY_SSH_OPTS)
      --bootstrap         With deploy: run bootstrap on each server first (it needs no checkout)
EOF
}

need_value() { if [ $# -lt 2 ] || [ -z "$2" ]; then die "$1 needs a value"; fi; }

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      -h|--help|help) usage; exit 0 ;;
      -y|--yes) YES=1; PASS_ARGS+=("$1") ;;
      -p|--project) need_value "$@"; PROJECT=$2; PASS_ARGS+=("$1" "$2"); shift ;;
      --web-port) need_value "$@"; WEB_PORT_OPT=$2; PASS_ARGS+=("$1" "$2"); shift ;;
      --set) need_value "$@"; SETS+=("$2"); PASS_ARGS+=("$1" "$2"); shift ;;
      --reconfigure) RECONFIGURE=1; PASS_ARGS+=("$1") ;;
      --pull) PULL=1; PASS_ARGS+=("$1") ;;
      --no-pull) PULL=0; PASS_ARGS+=("$1") ;;
      --reveal) REVEAL=1; PASS_ARGS+=("$1") ;;
      --confirm) need_value "$@"; CONFIRM=$2; PASS_ARGS+=("$1" "$2"); shift ;;
      --wipe) WIPE=1; PASS_ARGS+=("$1") ;;
      --down) DOWN=1; PASS_ARGS+=("$1") ;;
      --file) need_value "$@"; FILE=$2; PASS_ARGS+=("$1" "$2"); shift ;;
      --follow|-f) FOLLOW=1; PASS_ARGS+=("$1") ;;
      --service) need_value "$@"; SERVICE=$2; PASS_ARGS+=("$1" "$2"); shift ;;
      --tail) need_value "$@"; TAIL=$2; PASS_ARGS+=("$1" "$2"); shift ;;
      --keep-days) need_value "$@"; KEEP_DAYS=$2; PASS_ARGS+=("$1" "$2"); shift ;;
      --at) need_value "$@"; AT=$2; PASS_ARGS+=("$1" "$2"); shift ;;
      --bootstrap) BOOTSTRAP=1 ;;
      --host) need_value "$@"; HOSTS+=("$2"); shift ;;
      --servers) need_value "$@"; SERVERS_FILE=$2; shift ;;
      --dir) need_value "$@"; REMOTE_DIR=$2; shift ;;
      --repo) need_value "$@"; REPO_URL=$2; shift ;;
      --branch) need_value "$@"; BRANCH=$2; shift ;;
      --ssh-opts) need_value "$@"; SSH_OPTS=$2; shift ;;
      -*) die "unknown option $1 (see --help)" ;;
      *)
        if [ -z "$ACTION" ]; then ACTION=$1
        elif [ "$ACTION" = restore ] && [ -z "$FILE" ]; then FILE=$1
        else die "unexpected argument $1"
        fi
        PASS_ARGS+=("$1") ;;
    esac
    shift
  done
}

# --- prompts ---------------------------------------------------------------------------
interactive() { [ "$YES" -eq 0 ] && [ -t 0 ]; }

# ask "Question" default -> the answer on stdout (the default when not interactive)
ask() {
  local answer=""
  if interactive; then
    read -r -p "  $1 [$2]: " answer || true
  fi
  printf '%s' "${answer:-$2}"
}

# confirm "Question" y|n -> status 0 for yes
confirm() {
  local hint="y/N" answer=""
  [ "$2" = y ] && hint="Y/n"
  if ! interactive; then [ "$2" = y ]; return; fi
  read -r -p "  $1 [$hint]: " answer || true
  answer=$(printf '%s' "${answer:-$2}" | tr '[:upper:]' '[:lower:]')
  [ "$answer" = y ] || [ "$answer" = yes ]
}

# typed_confirm "what will happen" -> returns only if the operator typed the project name
typed_confirm() {
  local word typed=""
  word=$(project_name)
  if [ -n "$CONFIRM" ]; then
    [ "$CONFIRM" = "$word" ] || die "--confirm must be the project name '$word'"
    return 0
  fi
  interactive || die "$1 Add --confirm $word to go ahead."
  printf '  %s%s%s\n' "$C_YELLOW" "$1" "$C_OFF"
  read -r -p "  Type the project name '$word' to go ahead: " typed || true
  [ "$typed" = "$word" ] || die "not confirmed; nothing was changed"
}

# --- .env ------------------------------------------------------------------------------
env_get() {
  local file=${2:-$ENV_FILE} line
  [ -f "$file" ] || return 0
  line=$(grep -E "^$1=" "$file" | tail -n 1 | tr -d '\r')
  line=${line#*=}
  line=${line#\"}; line=${line%\"}
  printf '%s' "$line"
}

# env_set KEY VALUE: replace KEY= (or a commented "# KEY="), else append. Keeps the file's mode.
env_set() {
  local tmp
  tmp=$(umask 077; mktemp "${TMPDIR:-/tmp}/deploy-env.XXXXXX") || die "cannot create a temp file"
  awk -v k="$1" -v v="$2" '
    { sub(/\r$/, "") }
    $0 ~ "^" k "=" { if (!done) { print k "=" v; done = 1 } ; next }
    $0 ~ "^#[ ]*" k "=" && !done { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$ENV_FILE" > "$tmp" && cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
    echo
  fi
}

is_windows_shell() { case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) return 0 ;; esac; return 1; }

lock_env() {
  is_windows_shell || chmod 600 "$ENV_FILE"
}

valid_tunable() {
  case "$1" in
    WEB_PORT) printf '%s' "$2" | grep -Eq '^([0-9.]+:|\[[0-9a-fA-F:]+\]:)?[0-9]{1,5}$' ;;
    LEGACY_TIME_ZONE) [ -z "$2" ] || printf '%s' "$2" | grep -Eq '^[A-Za-z0-9_/+:-]+$' ;;
    *) printf '%s' "$2" | grep -Eq '^[0-9]+$' ;;
  esac
}

known_key() {
  local k
  for k in WEB_PORT $TUNABLES; do [ "$k" = "$1" ] && return 0; done
  return 1
}

apply_flags_to_env() {
  local kv key value
  if [ -n "$WEB_PORT_OPT" ]; then
    valid_tunable WEB_PORT "$WEB_PORT_OPT" || die "--web-port: '$WEB_PORT_OPT' is not PORT or ADDR:PORT"
    env_set WEB_PORT "$WEB_PORT_OPT"; ok "WEB_PORT=$WEB_PORT_OPT"
  fi
  for kv in ${SETS[@]+"${SETS[@]}"}; do
    key=${kv%%=*}; value=${kv#*=}
    known_key "$key" || die "--set: $key is not a setting this script manages (WEB_PORT $TUNABLES)"
    valid_tunable "$key" "$value" || die "--set: '$value' is not valid for $key"
    env_set "$key" "$value"; ok "$key=$value"
  done
}

prompt_tunables() {
  local k current value
  current=$(env_get WEB_PORT); current=${current:-80}
  while :; do
    value=$(ask "Web port (PORT, or 127.0.0.1:PORT behind a TLS proxy)" "$current")
    valid_tunable WEB_PORT "$value" && break
    warn "'$value' is not PORT or ADDR:PORT"
  done
  env_set WEB_PORT "$value"
  if confirm "Change the alarm thresholds and retention from their defaults?" n; then
    for k in $TUNABLES; do
      current=$(env_get "$k")
      while :; do
        value=$(ask "$k" "$current")
        valid_tunable "$k" "$value" && break
        warn "'$value' is not valid for $k"
      done
      if [ "$k" = LEGACY_TIME_ZONE ] && [ -z "$value" ]; then continue; fi
      env_set "$k" "$value"
    done
  fi
}

fill_missing_secrets() {
  local k filled=""
  for k in $SECRETS; do
    if [ -z "$(env_get "$k")" ]; then
      env_set "$k" "$(gen_secret)"; filled="$filled $k"
    fi
  done
  [ -n "$filled" ] && ok "Generated${filled} (never printed; see: deploy.sh info --reveal)"
  return 0
}

# The project Compose itself runs under: -p or COMPOSE_PROJECT_NAME when given, otherwise the
# folder name. The database volume is named after it, so the default is never overridden.
project_name() {
  local name
  name=$(dc config 2>/dev/null | sed -n 's/^name: //p' | head -n 1 | tr -d '"\r')
  if [ -z "$name" ]; then
    name=${COMPOSE_PROJECT_NAME:-}
    [ -n "$name" ] || name=$(env_get COMPOSE_PROJECT_NAME)
    [ -n "$name" ] || name=$(basename "$REPO_DIR")
    name=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')
  fi
  printf '%s' "$name"
}

web_port_setting() {
  local p=$WEB_PORT_OPT
  [ -n "$p" ] || p=$(env_get WEB_PORT)
  printf '%s' "${p:-80}"
}

# The address to reach web on from this machine, and the port number.
web_host() {
  local wp addr
  wp=$(web_port_setting)
  case "$wp" in *:*) addr=${wp%:*} ;; *) addr="" ;; esac
  addr=${addr#[}; addr=${addr%]}
  case "$addr" in ""|0.0.0.0|::) printf '127.0.0.1' ;; *) printf '%s' "$addr" ;; esac
}
web_port_num() { local wp; wp=$(web_port_setting); printf '%s' "${wp##*:}"; }

dc() { docker compose ${DC_ARGS[@]+"${DC_ARGS[@]}"} "$@"; }

running() { [ -n "$(dc ps --status running -q "$1" 2>/dev/null)" ]; }

# --- actions ---------------------------------------------------------------------------
do_preflight() {
  step "Preflight"
  local failed=0 v major port host avail dir root
  if command -v docker >/dev/null 2>&1; then ok "docker: $(docker --version)"
  elif [ "$(uname -s)" = Linux ]; then bad "docker is not installed; prepare this server with: deploy/deploy.sh bootstrap"; return 1
  else bad "docker is not installed: https://docs.docker.com/engine/install/"; return 1; fi

  v=$(docker compose version --short 2>/dev/null) || v=""
  major=${v#v}; major=${major%%.*}
  if [ -n "$v" ] && [ "$major" -ge 2 ] 2>/dev/null; then ok "docker compose $v"
  else bad "Docker Compose v2 is missing (docker compose version); install the compose plugin"; failed=1; fi

  if docker info >/dev/null 2>&1; then ok "Docker daemon is up"
  else
    bad "cannot reach the Docker daemon: $(docker info 2>&1 | grep -i -m1 -E 'error|denied|cannot' || echo 'not running')"
    say "         Start Docker, or add this user to the docker group (deploy/deploy.sh bootstrap does both), then log in again."
    return 1
  fi
  v=$(docker info --format '{{.OSType}}' 2>/dev/null)
  if [ "$v" != linux ]; then
    bad "Docker runs $v containers; the stack needs Linux containers"; failed=1
  fi

  if [ -f compose.yaml ] && [ -f .env.example ]; then ok "compose.yaml and .env.example in $REPO_DIR"
  else bad "compose.yaml or .env.example missing in $REPO_DIR"; failed=1; fi

  port=$(web_port_num); host=$(web_host)
  if (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; then
    if running web && docker port "$(dc ps -q web)" 2>/dev/null | grep -q ":$port\$"; then
      ok "port $port is this stack's own web"
    else
      bad "port $port on $host is in use by something else; pick another with --web-port"; failed=1
    fi
  else
    ok "port $port is free"
  fi

  for dir in "$REPO_DIR" "$(docker info --format '{{.DockerRootDir}}' 2>/dev/null)"; do
    if [ -z "$dir" ] || [ ! -d "$dir" ]; then continue; fi
    avail=$(df -Pk "$dir" 2>/dev/null | awk 'NR==2 {print int($4/1024)}')
    [ -n "$avail" ] || continue
    root=$dir
    if [ "$avail" -lt 1024 ]; then bad "only ${avail} MB free on $root; the first build needs about 3.5 GB"; failed=1
    elif [ "$avail" -lt 5120 ]; then warn "${avail} MB free on $root; 5 GB leaves room for images and backups"
    else ok "${avail} MB free on $root"; fi
  done
  return $failed
}

do_install() {
  step "Configure .env"
  if [ -f "$ENV_FILE" ]; then
    ok ".env exists; keeping it"
    fill_missing_secrets
    if [ -n "$WEB_PORT_OPT" ] || [ ${#SETS[@]} -gt 0 ]; then
      if [ "$RECONFIGURE" -eq 1 ] || { interactive && confirm "Write the given settings into the existing .env? Secrets are kept." n; }; then
        apply_flags_to_env
      else
        warn "settings given but .env left unchanged; add --reconfigure to apply them"
      fi
    elif [ "$RECONFIGURE" -eq 1 ] || { interactive && confirm "Change the port and tunables in the existing .env? Secrets are kept." n; }; then
      prompt_tunables
    fi
  else
    (umask 077; tr -d '\r' < .env.example > "$ENV_FILE") || die "cannot write .env"
    ok "created .env from .env.example"
    fill_missing_secrets
    # Pin the project, which names the database volume, to the one Compose picks now (the
    # folder name, or -p), so a renamed or moved checkout keeps its data. Written once, here.
    local name
    name=${PROJECT:-$(project_name)}
    env_set COMPOSE_PROJECT_NAME "$name"
    ok "COMPOSE_PROJECT_NAME=$name (names the database volume, ${name}_db-data)"
    if [ -n "$WEB_PORT_OPT" ] || [ ${#SETS[@]} -gt 0 ] || ! interactive; then
      apply_flags_to_env
    else
      prompt_tunables
    fi
  fi
  lock_env
  ok "web port $(web_port_setting), project $(project_name)"
}

maybe_pull() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  [ "$PULL" = 0 ] && return 0
  if [ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    warn "local changes in the checkout; not pulling"; return 0
  fi
  # Without --pull, pull only when someone at the keyboard agrees.
  if [ "$PULL" != 1 ]; then
    interactive || return 0
    confirm "Pull the latest code (git pull --ff-only)?" y || return 0
  fi
  local before after
  before=$(git rev-parse HEAD)
  git pull --ff-only || die "git pull failed; resolve it or deploy with --no-pull"
  after=$(git rev-parse HEAD)
  if [ "$before" != "$after" ]; then
    ok "updated ${before:0:7} -> ${after:0:7}; restarting with the new script"
    exec bash "$SCRIPT_PATH" ${ORIG_ARGS[@]+"${ORIG_ARGS[@]}"} --no-pull
  fi
  ok "code already up to date"
}

check_secrets() {
  local k
  for k in $SECRETS; do [ -n "$(env_get "$k")" ] || die "$k is empty in .env; run: deploy.sh install"; done
}

health() {
  local url body i tries=${1:-30}
  url="http://$(web_host):$(web_port_num)/api/health"
  for i in $(seq 1 "$tries"); do
    if command -v curl >/dev/null 2>&1; then body=$(curl -fsS --max-time 5 "$url" 2>/dev/null)
    elif command -v wget >/dev/null 2>&1; then body=$(wget -qO- -T 5 "$url" 2>/dev/null)
    else
      url="web:/api/health (inside the container)"
      body=$(dc exec -T web sh -c 'wget -qO- -T 5 http://127.0.0.1:8080/api/health || wget -qO- -T 5 http://127.0.0.1/api/health' 2>/dev/null)
    fi
    case "$body" in *'"ok"'*) ok "$url -> $body"; return 0 ;; esac
    [ "$i" -lt "$tries" ] && sleep 2
  done
  bad "$url did not answer ok${body:+ (last: $body)}"
  return 1
}

site_url() {
  local port host
  port=$(web_port_num); host=$(web_host)
  if [ "$host" = 127.0.0.1 ]; then
    host=$( (hostname -I 2>/dev/null || true) | awk '{print $1}')
    [ -n "$host" ] || host=$(hostname 2>/dev/null || echo localhost)
  fi
  [ "$port" = 80 ] && printf 'http://%s/' "$host" || printf 'http://%s:%s/' "$host" "$port"
}

do_deploy() {
  [ -f "$ENV_FILE" ] || do_install
  check_secrets
  maybe_pull
  do_preflight || die "preflight failed; fix the [FAIL] lines above"
  # A plain `up --build` reuses whatever node and nginx base images are cached, so a server
  # would never get their security patches; --pull checks for newer ones on every deploy.
  step "Build with fresh base images (docker compose build --pull)"
  if ! dc build --pull; then
    warn "the build with --pull failed (no registry?); the next step builds from the local cache"
  fi
  step "Build and start (docker compose up -d --build --wait)"
  if ! dc up -d --build --remove-orphans --wait --wait-timeout 600; then
    dc ps
    say "Last api log lines:"; dc logs --tail 40 api
    die "the stack did not become healthy"
  fi
  step "Health through web"
  health 30 || die "the stack is up but /api/health through web failed; see: deploy.sh logs"
  say ""
  say "${C_GREEN}Deployed.${C_OFF} Dashboard: $(site_url)  (Settings needs the Admin token: deploy.sh info --reveal)"
}

do_status() {
  [ -f "$ENV_FILE" ] || die "not installed here yet (no .env); run: deploy.sh deploy"
  step "Containers ($(project_name))"
  dc ps
  step "Health"
  if running web; then health 3; else bad "web is not running"; return 1; fi
}

do_logs() {
  local args=(logs --tail "$TAIL")
  [ "$FOLLOW" -eq 1 ] && args+=(-f)
  [ -n "$SERVICE" ] && args+=("$SERVICE")
  dc "${args[@]}"
}

do_backup() {
  step "Back up the database"
  running db || die "db is not running; start the stack first (deploy.sh deploy)"
  local file
  mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR" 2>/dev/null
  file="$BACKUP_DIR/$(project_name)_$(date +%Y%m%d-%H%M%S).sql.gz"
  # shellcheck disable=SC2016 # $MYSQL_ROOT_PASSWORD expands inside the db container
  if ! (umask 077; dc exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --triggers --no-tablespaces '"$DB_NAME" | gzip > "$file"); then
    rm -f "$file"; die "mysqldump failed"
  fi
  if ! gzip -dc "$file" | tail -n 1 | grep -q 'Dump completed'; then
    rm -f "$file"; die "the dump is incomplete; nothing kept"
  fi
  ok "$file ($(du -k "$file" | awk '{print $1}') KB)"
  LAST_BACKUP=$file
  [ -n "$KEEP_DAYS" ] && prune_backups
  return 0
}

# Deletes this project's backups older than --keep-days; never the one just made.
prune_backups() {
  local f n=0
  valid_days "$KEEP_DAYS" || die "--keep-days must be a whole number of days, 1 or more"
  while IFS= read -r f; do
    [ "$f" = "$LAST_BACKUP" ] && continue
    rm -f "$f" && n=$((n + 1))
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "$(project_name)_*.sql.gz" -mmin +$((KEEP_DAYS * 1440)) 2>/dev/null)
  ok "kept $KEEP_DAYS days of backups; removed $n older"
}

valid_days() { printf '%s' "$1" | grep -Eq '^[0-9]+$' && [ "$1" -ge 1 ]; }

pick_backup() {
  local files=() f i=1 choice
  while IFS= read -r f; do files+=("$f"); done < <(ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null)
  [ ${#files[@]} -gt 0 ] || die "no backups in $BACKUP_DIR/; give one with --file"
  interactive || die "restore needs --file FILE"
  for f in "${files[@]}"; do say "  $i) $f"; i=$((i + 1)); done
  choice=$(ask "Restore which" 1)
  if ! { [ "$choice" -ge 1 ] && [ "$choice" -le ${#files[@]} ]; } 2>/dev/null; then die "no such backup"; fi
  FILE=${files[$((choice - 1))]}
}

do_restore() {
  step "Restore the database"
  running db || die "db is not running; start the stack first (deploy.sh deploy)"
  [ -n "$FILE" ] || pick_backup
  [ -f "$FILE" ] || die "$FILE does not exist"
  gzip -t "$FILE" 2>/dev/null || die "$FILE is not a readable .sql.gz"
  typed_confirm "This replaces every table in the $(project_name) database with $FILE."
  do_backup
  ok "the current database is saved in $LAST_BACKUP"
  dc stop api
  # shellcheck disable=SC2016 # $MYSQL_ROOT_PASSWORD expands inside the db container
  if ! gzip -dc "$FILE" | dc exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot '"$DB_NAME"; then
    dc up -d --wait api
    die "the restore failed part-way; put the previous state back with: deploy.sh restore --file $LAST_BACKUP"
  fi
  ok "restored $FILE"
  dc up -d --wait api || die "api did not come back healthy; see: deploy.sh logs --service api"
  health 30
}

do_migrate_legacy() {
  running api || die "api is not running; start the stack first (deploy.sh deploy)"
  do_backup
  step "Legacy migration (npm run migrate:legacy)"
  dc exec -T api npm run migrate:legacy || die "the legacy migration failed; see the lines above and DEPLOYMENT.md"
  say "Each 'legacy:' line names a row it skipped. Verify the counts as DEPLOYMENT.md describes."
}

mask() {
  local s=$1
  if [ "$REVEAL" -eq 1 ]; then printf '%s' "$s"
  elif [ ${#s} -le 8 ]; then printf '********'
  else printf '%s...%s' "${s:0:4}" "${s: -4}"; fi
}

do_info() {
  [ -f "$ENV_FILE" ] || die "no .env yet; run: deploy.sh install"
  if [ "$REVEAL" -eq 0 ] && interactive && confirm "Show the tokens in full on this screen?" n; then REVEAL=1; fi
  local url interval server
  url=$(site_url); server=${url%/}
  interval=$(env_get REPORT_INTERVAL_SECONDS)
  step "Temperature Alarms ($(project_name))"
  say "  Dashboard     $url"
  say "  Admin token   $(mask "$(env_get ADMIN_TOKEN)")   (Settings page)"
  say "  Device token  $(mask "$(env_get DEVICE_TOKEN)")"
  say "  DB password   $(mask "$(env_get DB_PASSWORD)")"
  say ""
  say "  For arduino/TemperatureAlarms/config.h:"
  say "    #define SERVER_URL \"$server\""
  say "    #define DEVICE_TOKEN \"$(mask "$(env_get DEVICE_TOKEN)")\""
  [ -n "$interval" ] && [ "$interval" != 30 ] && say "    #define REPORT_INTERVAL_SECONDS $interval"
  [ "$REVEAL" -eq 0 ] && say "  ${C_DIM}Masked. Add --reveal to print them in full.${C_OFF}"
  return 0
}

do_stop() {
  step "Stop"
  dc stop && ok "stopped; data and .env kept. Start again with: deploy.sh deploy"
}

do_uninstall() {
  step "Uninstall"
  if [ "$WIPE" -eq 0 ] && interactive && confirm "Also delete the database volume (every Reading, Campus, and Device)?" n; then WIPE=1; fi
  if [ "$WIPE" -eq 1 ]; then
    typed_confirm "This deletes the $(project_name) database volume for good. Back up first if in doubt."
    dc down -v --rmi local --remove-orphans || die "docker compose down failed"
    ok "containers, built images, and the database volume removed"
  else
    dc down --rmi local --remove-orphans || die "docker compose down failed"
    ok "containers and built images removed; the database volume stays (--wipe deletes it)"
  fi
  # A nightly backup of a removed stack fails every night, so its crontab line goes too.
  if ! is_windows_shell && command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep -qF "$(cron_marker)"; then
    crontab -l 2>/dev/null | without_marker | write_crontab
    ok "removed the nightly backup from $(id -un)'s crontab (schedule-backup puts it back)"
  fi
  say "  .env and $BACKUP_DIR/ are left in $REPO_DIR."
}

# --- demo ----------------------------------------------------------------------------
# Everything below runs against the demo's own project and .env.demo, never the real ones.
use_demo() {
  ENV_FILE=$DEMO_ENV
  DC_ARGS=(-p "$DEMO_PROJECT" --env-file "$DEMO_ENV" -f compose.yaml -f compose.demo.yaml)
}

write_demo_env() {
  local k
  (umask 077; printf '%s
'     "# Throwaway settings for deploy.sh demo (compose.demo.yaml). deploy.sh demo --down deletes this file."     "COMPOSE_PROJECT_NAME=$DEMO_PROJECT" "WEB_PORT=$DEMO_PORT" > "$ENV_FILE") || die "cannot write $ENV_FILE"
  for k in $SECRETS; do env_set "$k" "$(gen_secret)"; done
  lock_env
  ok "created $ENV_FILE with fresh secrets"
}

do_demo() {
  [ -f compose.demo.yaml ] || die "compose.demo.yaml is missing in $REPO_DIR"
  use_demo
  if [ "$DOWN" -eq 1 ]; then
    step "Remove the demo ($DEMO_PROJECT)"
    # down reads the files, and compose.yaml needs the secrets set, so a missing file is remade first.
    [ -f "$ENV_FILE" ] || write_demo_env
    dc down -v --rmi local --remove-orphans || die "docker compose down failed"
    rm -f "$ENV_FILE"
    if [ -n "$(docker volume ls -q --filter "label=com.docker.compose.project=$DEMO_PROJECT")" ]; then
      bad "a $DEMO_PROJECT volume is still there: docker volume ls --filter label=com.docker.compose.project=$DEMO_PROJECT"
      return 1
    fi
    ok "containers, images, the demo database volume, and $ENV_FILE removed"
    return 0
  fi
  step "Demo settings ($ENV_FILE)"
  if [ -f "$ENV_FILE" ]; then ok "$ENV_FILE exists; keeping its secrets"; else write_demo_env; fi
  apply_flags_to_env
  do_preflight || die "preflight failed; fix the [FAIL] lines above"
  step "Build and start the demo (project $DEMO_PROJECT)"
  if ! dc up -d --build --remove-orphans --wait --wait-timeout 600; then
    dc ps
    say "Last demo log lines:"; dc logs --tail 40 demo api
    die "the demo did not come up"
  fi
  step "Health through web"
  health 30 || die "the demo is up but /api/health through web failed; see: docker compose -p $DEMO_PROJECT logs"
  say ""
  say "${C_GREEN}Demo running.${C_OFF} Dashboard: $(site_url)"
  say "  The first minute seeds 4 Campuses and 24 Devices and writes a week of history; then"
  say "  the closets loop through Hot, Dry, Mold risk, Cold, late, and Offline every 10 minutes."
  say "  Admin token for Settings (throwaway): $(env_get ADMIN_TOKEN)"
  say "  Watch it:  docker compose -p $DEMO_PROJECT logs -f demo"
  say "  Remove it: deploy/deploy.sh demo --down"
}

# --- bootstrap -------------------------------------------------------------------------
# Docker Engine and the Compose plugin come from Docker's own repository, the way
# https://docs.docker.com/engine/install/ describes "install using the repository".
DOCKER_PKGS="docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"
SUDO=""
APT_UPDATED=0

as_root() { ${SUDO:+"$SUDO"} "$@"; }

need_root() {
  if [ "$(id -u)" -eq 0 ]; then SUDO=""; return 0; fi
  command -v sudo >/dev/null 2>&1 || die "bootstrap needs root: run it as root, or install sudo and give $(id -un) sudo rights"
  SUDO=sudo
  sudo -n true 2>/dev/null && return 0
  [ -t 0 ] || die "sudo needs $(id -un)'s password and there is no terminal to type it in; run bootstrap from a terminal (over ssh, a session with a tty), or give $(id -un) passwordless sudo"
  say "  sudo asks for $(id -un)'s password once."
  sudo -v || die "sudo refused; $(id -un) needs sudo rights to install packages"
}

os_field() {
  # shellcheck disable=SC1091 # read at run time on the server
  (. /etc/os-release && eval "printf '%s' \"\${$1:-}\"")
}

have_compose() { command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; }

apt_get() { as_root env DEBIAN_FRONTEND=noninteractive apt-get -y -q "$@"; }
apt_update() {
  [ "$APT_UPDATED" -eq 1 ] && return 0
  apt_get update >/dev/null || die "apt-get update failed; see: sudo apt-get update"
  APT_UPDATED=1
}

# pkg_install apt|dnf PACKAGE... installs the given packages, quietly.
pkg_install() {
  local family=$1; shift
  if [ "$family" = apt ]; then
    apt_update
    apt_get install "$@" >/dev/null || die "apt-get install $* failed"
  else
    as_root dnf -y -q install "$@" >/dev/null || die "dnf install $* failed"
  fi
}

docker_repo_apt() {
  local repo=$1 codename=$2
  [ -n "$codename" ] || die "cannot tell this release's codename from /etc/os-release"
  step "Docker's apt repository ($repo $codename)"
  command -v curl >/dev/null 2>&1 || pkg_install apt curl
  pkg_install apt ca-certificates
  as_root install -m 0755 -d /etc/apt/keyrings
  as_root curl -fsSL "https://download.docker.com/linux/$repo/gpg" -o /etc/apt/keyrings/docker.asc || die "cannot download Docker's GPG key"
  as_root chmod a+r /etc/apt/keyrings/docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
    "$(dpkg --print-architecture)" "$repo" "$codename" | as_root tee /etc/apt/sources.list.d/docker.list >/dev/null
  ok "/etc/apt/sources.list.d/docker.list, signed by /etc/apt/keyrings/docker.asc"
  APT_UPDATED=0
  apt_update
}

docker_repo_dnf() {
  local repo=$1
  step "Docker's dnf repository ($repo)"
  command -v curl >/dev/null 2>&1 || pkg_install dnf curl
  as_root curl -fsSL "https://download.docker.com/linux/$repo/docker-ce.repo" -o /etc/yum.repos.d/docker-ce.repo || die "cannot download docker-ce.repo"
  as_root rpm --import "https://download.docker.com/linux/$repo/gpg" || die "cannot import Docker's GPG key"
  ok "/etc/yum.repos.d/docker-ce.repo, key from https://download.docker.com/linux/$repo/gpg"
}

start_service() {
  if [ ! -d /run/systemd/system ]; then
    as_root service "$1" start >/dev/null 2>&1 && ok "$1 started (no systemd: start it again after a reboot)" && return 0
    die "cannot start $1; this server runs no systemd"
  fi
  if systemctl is-enabled --quiet "$1" 2>/dev/null && systemctl is-active --quiet "$1" 2>/dev/null; then
    ok "$1 is enabled and running"
  else
    as_root systemctl enable --now "$1" >/dev/null 2>&1 || die "cannot start $1: sudo systemctl enable --now $1"
    ok "$1 enabled and started"
  fi
}

do_bootstrap() {
  step "Bootstrap this server"
  [ "$(uname -s)" = Linux ] || die "bootstrap prepares Linux servers; on $(uname -s), install Docker Desktop: https://docs.docker.com/desktop/"
  [ -r /etc/os-release ] || die "no /etc/os-release, so this Linux cannot be identified; install Docker by hand: https://docs.docker.com/engine/install/"
  local id version codename family repo cron_pkg cron_svc user missing="" added=0
  id=$(os_field ID); version=$(os_field VERSION_ID)
  case "$id" in
    ubuntu|debian) family=apt; repo=$id; cron_pkg=cron; cron_svc=cron ;;
    rhel) family=dnf; repo=rhel; cron_pkg=cronie; cron_svc=crond ;;
    rocky|almalinux|centos) family=dnf; repo=centos; cron_pkg=cronie; cron_svc=crond ;;
    fedora) family=dnf; repo=fedora; cron_pkg=cronie; cron_svc=crond ;;
    *) die "bootstrap supports Ubuntu, Debian, RHEL, Rocky, AlmaLinux, CentOS Stream, and Fedora; this is '${id:-unknown}' ${version}. Install Docker Engine and its compose plugin by hand: https://docs.docker.com/engine/install/" ;;
  esac
  ok "$(os_field PRETTY_NAME)"
  need_root

  if have_compose; then
    ok "Docker is installed: $(docker --version), compose $(docker compose version --short)"
  elif command -v docker >/dev/null 2>&1; then
    die "docker is installed without Compose v2 (likely the distribution's own docker or podman-docker). Remove it as https://docs.docker.com/engine/install/$repo/#uninstall-old-versions describes, then run bootstrap again."
  else
    if [ "$family" = apt ]; then
      codename=$(os_field UBUNTU_CODENAME); [ -n "$codename" ] || codename=$(os_field VERSION_CODENAME)
      docker_repo_apt "$repo" "$codename"
    else
      docker_repo_dnf "$repo"
    fi
    step "Install Docker Engine and the Compose plugin"
    # shellcheck disable=SC2086 # a list of package names
    pkg_install "$family" $DOCKER_PKGS
    have_compose || die "Docker installed but 'docker compose version' fails"
    ok "$(docker --version), compose $(docker compose version --short)"
  fi

  step "git and cron"
  command -v git >/dev/null 2>&1 || missing="$missing git"
  command -v crontab >/dev/null 2>&1 || missing="$missing $cron_pkg"
  if [ -n "$missing" ]; then
    # shellcheck disable=SC2086 # a list of package names
    pkg_install "$family" $missing
    ok "installed${missing}"
  else
    ok "git and crontab are installed"
  fi

  step "Services"
  start_service docker
  start_service "$cron_svc"

  step "The docker group"
  user=${SUDO_USER:-$(id -un)}
  if [ "$user" = root ]; then
    ok "running as root, which needs no docker group"
  elif id -nG "$user" | tr ' ' '\n' | grep -qx docker; then
    ok "$user is in the docker group"
  else
    as_root usermod -aG docker "$user" || die "cannot add $user to the docker group"
    ok "added $user to the docker group"; added=1
  fi

  say ""
  if [ "$user" != root ] && { [ "$added" -eq 1 ] || ! id -nG | tr ' ' '\n' | grep -qx docker; }; then
    say "${C_GREEN}Bootstrapped.${C_OFF} ${C_YELLOW}Log out and back in (a new ssh session) so $user's docker group takes effect,${C_OFF}"
    say "then: deploy/deploy.sh deploy --yes"
  else
    say "${C_GREEN}Bootstrapped.${C_OFF} Next: deploy/deploy.sh deploy --yes"
  fi
}

# --- nightly backup --------------------------------------------------------------------
# One crontab line per checkout, found by this marker at its end; other lines are left alone.
cron_marker() { printf '# temperature-alarms backup: %s' "$REPO_DIR"; }

without_marker() {
  awk -v m="$(cron_marker)" '{ n = length($0) - length(m) + 1; if (n >= 1 && substr($0, n) == m) next; print }'
}

valid_time() { printf '%s' "$1" | grep -Eq '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'; }

backup_command() {
  local cmd="bash deploy/deploy.sh backup --yes --keep-days ${KEEP_DAYS:-7}"
  [ -n "$PROJECT" ] && cmd="$cmd -p $(squote "$PROJECT")"
  printf '%s' "$cmd"
}

# Task Scheduler runs Git's bash on deploy.sh with plain arguments: no shell line, so no
# quoting to survive schtasks. The script finds its checkout on its own.
windows_schedule_hint() {
  local bash_exe task_args="backup --yes --keep-days ${KEEP_DAYS:-7}"
  bash_exe="$(cygpath -w / 2>/dev/null)bin\bash.exe"
  [ -f "$(cygpath -u "$bash_exe" 2>/dev/null)" ] || bash_exe=$(cygpath -w "$(command -v bash)")
  [ -n "$PROJECT" ] && task_args="$task_args -p $PROJECT"
  warn "Git Bash has no cron; Windows schedules it with Task Scheduler. In a Command Prompt:"
  if [ "$1" = schedule ]; then
    printf '    schtasks /Create /F /TN "Temperature Alarms backup" /SC DAILY /ST %s /TR "\\"%s\\" \\"%s\\" %s"\n' \
      "$(printf '%02d:%s' "$((10#${AT%%:*}))" "${AT#*:}")" "$bash_exe" "$(cygpath -m "$SCRIPT_PATH")" "$task_args"
  else
    say '    schtasks /Delete /F /TN "Temperature Alarms backup"'
  fi
  return 1
}

write_crontab() {
  local tmp
  tmp=$(mktemp "${TMPDIR:-/tmp}/deploy-cron.XXXXXX") || die "cannot create a temp file"
  cat > "$tmp"
  crontab "$tmp" || { rm -f "$tmp"; die "crontab refused the new table"; }
  rm -f "$tmp"
}

do_schedule_backup() {
  step "Nightly backup"
  valid_time "$AT" || die "--at must be HH:MM (24-hour), e.g. 02:00"
  [ -z "$KEEP_DAYS" ] || valid_days "$KEEP_DAYS" || die "--keep-days must be a whole number of days, 1 or more"
  is_windows_shell && { windows_schedule_hint schedule; return 1; }
  command -v crontab >/dev/null 2>&1 || die "crontab is not installed; on Linux, deploy/deploy.sh bootstrap installs cron"
  [ -f "$ENV_FILE" ] || die "not installed here yet (no .env); run: deploy.sh deploy"
  local hh mm line current
  hh=$((10#${AT%%:*})); mm=$((10#${AT#*:}))
  mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR" 2>/dev/null
  line="$mm $hh * * * cd $(squote "$REPO_DIR") && PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:\$PATH $(backup_command) >> $BACKUP_DIR/backup.log 2>&1 $(cron_marker)"
  current=$(crontab -l 2>/dev/null) || current=""
  { [ -n "$current" ] && printf '%s\n' "$current" | without_marker; printf '%s\n' "$line"; } | write_crontab
  [ "$(crontab -l 2>/dev/null | grep -cF "$(cron_marker)")" = 1 ] || die "the crontab line did not stick; see: crontab -l"
  ok "crontab ($(id -un)): $line"
  ok "daily at $(printf '%02d:%02d' "$hh" "$mm"), keeping ${KEEP_DAYS:-7} days; output goes to $BACKUP_DIR/backup.log"
}

do_unschedule_backup() {
  step "Nightly backup"
  is_windows_shell && { windows_schedule_hint unschedule; return 1; }
  command -v crontab >/dev/null 2>&1 || { ok "no crontab here, so nothing is scheduled"; return 0; }
  local current
  current=$(crontab -l 2>/dev/null) || current=""
  if ! printf '%s\n' "$current" | grep -qF "$(cron_marker)"; then
    ok "no nightly backup is scheduled for $REPO_DIR"; return 0
  fi
  printf '%s\n' "$current" | without_marker | write_crontab
  ok "removed the nightly backup for $REPO_DIR from $(id -un)'s crontab"
}

run_action() {
  case "$1" in
    bootstrap) do_bootstrap ;;
    schedule-backup) do_schedule_backup ;;
    unschedule-backup) do_unschedule_backup ;;
    preflight) do_preflight ;;
    install) do_install ;;
    deploy|upgrade) do_deploy ;;
    status) do_status ;;
    logs) do_logs ;;
    backup) do_backup ;;
    restore) do_restore ;;
    migrate-legacy) do_migrate_legacy ;;
    info) do_info ;;
    stop) do_stop ;;
    uninstall) do_uninstall ;;
    demo) do_demo ;;
    *) die "unknown action '$1' (see --help)" ;;
  esac
}

menu() {
  local choice action
  while :; do
    printf '\n%sTemperature Alarms deploy%s  %s  (project %s, port %s)\n' "$C_BOLD" "$C_OFF" "$REPO_DIR" "$(project_name)" "$(web_port_setting)"
    say "   1) Preflight checks          8) Run the legacy migration"
    say "   2) First install (.env)      9) Show URL and tokens"
    say "   3) Deploy / upgrade         10) Stop"
    say "   4) Status                   11) Uninstall"
    say "   5) Logs                     12) Bootstrap this server (Docker, git, cron)"
    say "   6) Back up the database     13) Schedule a nightly backup"
    say "   7) Restore the database     14) Unschedule the nightly backup"
    say "  15) Demo, no hardware needed  q) Quit"
    read -r -p "  Choose: " choice || exit 0
    case "$choice" in
      1) action=preflight ;; 2) action=install ;; 3) action=deploy ;; 4) action=status ;;
      5) action=logs ;; 6) action=backup ;; 7) action=restore ;; 8) action=migrate-legacy ;;
      9) action=info ;; 10) action=stop ;; 11) action=uninstall ;; 12) action=bootstrap ;;
      13) action=schedule-backup ;; 14) action=unschedule-backup ;; 15) action=demo ;;
      q|Q|quit|exit) exit 0 ;;
      *) warn "no such choice"; continue ;;
    esac
    # A subshell, so a failed action returns to the menu instead of exiting it.
    ( run_action "$action" ) || warn "$action did not finish"
    FILE=""; REVEAL=0; WIPE=0
  done
}

# --- remote ----------------------------------------------------------------------------
squote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

remote_one() {
  local host=$1 cmd arg tty=() script
  cmd="bash deploy/deploy.sh"
  for arg in ${PASS_ARGS[@]+"${PASS_ARGS[@]}"}; do cmd="$cmd $(squote "$arg")"; done
  if [ "$ACTION" = deploy ] || [ "$ACTION" = upgrade ]; then
    [ -z "$PULL" ] && cmd="$cmd --pull"
  fi
  script="set -e
dir=$(squote "$REMOTE_DIR"); repo=$(squote "$REPO_URL"); branch=$(squote "$BRANCH")
case \"\$dir\" in '~/'*) dir=\"\$HOME/\${dir#??}\" ;; esac
command -v git >/dev/null 2>&1 || { echo 'git is not installed on this server' >&2; exit 2; }
if [ ! -d \"\$dir/.git\" ]; then
  if [ -e \"\$dir\" ]; then echo \"\$dir exists and is not a git checkout\" >&2; exit 2; fi
  [ -n \"\$repo\" ] || { echo 'no checkout here and no --repo to clone' >&2; exit 2; }
  echo \"Cloning \$repo into \$dir\"
  git clone \${branch:+--branch \"\$branch\"} \"\$repo\" \"\$dir\"
fi
cd \"\$dir\"
exec $cmd"
  if [ -t 0 ] && [ -t 1 ] && [ "$YES" -eq 0 ]; then tty=(-t); fi
  # shellcheck disable=SC2086,SC2029 # SSH_OPTS is a list of options; the command is quoted for the server
  ssh ${tty[@]+"${tty[@]}"} $SSH_OPTS "$host" "bash -c $(squote "$script")"
}

# bootstrap on a server that may have no git and no checkout yet: copy this script over on
# its own (base64 on stdin, so no command line gets long) and run it from a temp file. A tty
# when there is one here, so sudo can ask for a password.
remote_bootstrap() {
  local host=$1 tmp cmd tty=()
  # shellcheck disable=SC2086,SC2016 # SSH_OPTS is a list of options; $f expands on the server
  tmp=$(base64 < "$SCRIPT_PATH" | ssh $SSH_OPTS "$host" 'umask 077; f=$(mktemp) || exit 1; if tr -cd A-Za-z0-9+/= | base64 -d > $f; then echo $f; else rm -f $f; exit 1; fi' | tr -d '\r')
  [ -n "$tmp" ] || { bad "could not copy deploy.sh to $host"; return 1; }
  cmd="bash $tmp bootstrap"
  [ "$YES" -eq 1 ] && cmd="$cmd --yes"
  cmd="$cmd; rc=\$?; rm -f $tmp; exit \$rc"
  if [ -t 0 ] && [ -t 1 ]; then tty=(-t); fi
  # shellcheck disable=SC2086,SC2029 # SSH_OPTS is a list of options; the command is built for the server
  ssh ${tty[@]+"${tty[@]}"} $SSH_OPTS "$host" "$cmd"
}

remote_main() {
  local host line results=() failed=0
  if [ -n "$SERVERS_FILE" ]; then
    [ -f "$SERVERS_FILE" ] || die "$SERVERS_FILE does not exist"
    while IFS= read -r line || [ -n "$line" ]; do
      line=$(printf '%s' "${line%%#*}" | tr -d '\r' | awk '{print $1}')
      [ -n "$line" ] && HOSTS+=("$line")
    done < "$SERVERS_FILE"
  fi
  [ ${#HOSTS[@]} -gt 0 ] || die "no hosts in $SERVERS_FILE"
  [ -n "$ACTION" ] || [ ${#HOSTS[@]} -eq 1 ] || die "give an action for more than one host"
  [ -n "$ACTION" ] || interactive || die "give an action, or run interactively for the menu"
  command -v ssh >/dev/null 2>&1 || die "ssh is not installed here"
  [ -n "$REPO_URL" ] || REPO_URL=$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null || true)
  if [ "$BOOTSTRAP" -eq 1 ]; then
    case "$ACTION" in deploy|upgrade) ;; *) die "--bootstrap goes with deploy" ;; esac
  fi
  for host in "${HOSTS[@]}"; do
    step "$host: ${ACTION:-menu}"
    if [ "$ACTION" = bootstrap ]; then
      if remote_bootstrap "$host"; then results+=("ok    $host")
      else results+=("FAIL  $host"); failed=1; fi
      continue
    fi
    # Each ssh is a fresh login, so the deploy that follows already has the docker group.
    if [ "$BOOTSTRAP" -eq 1 ] && ! remote_bootstrap "$host"; then
      results+=("FAIL  $host (bootstrap)"); failed=1; continue
    fi
    if remote_one "$host"; then results+=("ok    $host")
    else results+=("FAIL  $host"); failed=1; fi
  done
  step "Summary (${ACTION:-menu})"
  for line in "${results[@]}"; do say "  $line"; done
  return $failed
}

main() {
  parse_args "$@"
  if [ ${#HOSTS[@]} -gt 0 ] || [ -n "$SERVERS_FILE" ]; then
    remote_main; exit
  fi
  [ "$BOOTSTRAP" -eq 0 ] || die "--bootstrap is for deploys to servers (--host, --servers); here, run bootstrap, log in again, then deploy"
  cd "$REPO_DIR" || die "cannot enter $REPO_DIR"
  [ -n "$PROJECT" ] && export COMPOSE_PROJECT_NAME="$PROJECT"
  if [ -z "$ACTION" ]; then
    interactive || { usage; exit 1; }
    menu
  fi
  run_action "$ACTION"
}

main "$@"
exit
