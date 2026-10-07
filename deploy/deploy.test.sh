#!/usr/bin/env bash
# Tests for deploy.sh's input gates: bash deploy/deploy.test.sh (Git Bash too). Needs no Docker.
# TRUST_PROXY must refuse every spelling of /0, as frontend/real-ip.sh does at container start,
# and a --host or servers-file entry must never reach ssh as an option.
set -u

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fails=0
fail() { echo "FAIL $*"; fails=$((fails + 1)); }

# The validators, lifted out of deploy.sh so they run without its main.
eval "$(sed -n '/^valid_ipv4() {/,/^}/p; /^valid_ipv6() {/,/^}/p; /^valid_address() {/,/^}/p; /^valid_trust_proxy() {/,/^}/p; /^valid_host() {/,/^}/p' "$here/deploy.sh")"

for v in "" 10.0.0.5 172.22.0.0/16 "10.0.0.5, 10.0.0.6" gateway "gateway,10.0.0.5" 2001:db8::/32 fd00::1 ::ffff:10.0.0.5; do
  valid_trust_proxy "$v" || fail "TRUST_PROXY '$v' refused"
done
for v in 0.0.0.0/0 1.2.3.4/00 0.0.0.0/000 ::/0 ::/00 ::/000 "10.0.0.5,::/00" 1.2.3.4/33 ::/129 256.1.1.1 caddy \
  '1.2.3.4;' '*' '/*' ':' "$(printf '10.0.0.5\n10.0.0.6')" "$(printf '10.0.0.5\nADMIN_TOKEN=x')"; do
  valid_trust_proxy "$v" && fail "TRUST_PROXY '$v' accepted"
done

for v in admin@10.0.0.5 admin@server.district.org server deploy_user@fd00::1; do
  valid_host "$v" || fail "host '$v' refused"
done
# shellcheck disable=SC2016 # literal payloads, never expanded
for v in -oProxyCommand=id "-oProxyCommand=touch /tmp/x" -p2222 "admin@server -oX" "$(printf 'a\nb')" "a;id" '$(id)' ""; do
  valid_host "$v" && fail "host '$v' accepted"
done

# TRUST_PROXY=gateway believes anything arriving from the Docker gateway, which is also where Docker's
# userland proxy delivers IPv6 clients from. Only safe with web published on the loopback address.
eval "$(sed -n '/^env_get() {/,/^}/p; /^web_port_setting() {/,/^}/p; /^gateway_exposed() {/,/^}/p' "$here/deploy.sh")"
# shellcheck disable=SC2034 # read by web_port_setting, lifted from deploy.sh
WEB_PORT_OPT=""
ENV_FILE="$work/.env"
exposed() { printf 'WEB_PORT=%s\nTRUST_PROXY=%s\n' "$1" "$2" > "$ENV_FILE"; gateway_exposed; }
exposed 80 gateway || fail "gateway on port 80 (all addresses) not flagged"
exposed 0.0.0.0:8080 "10.0.0.5, gateway" || fail "gateway on 0.0.0.0:8080 not flagged"
exposed "[::]:8080" gateway || fail "gateway on [::]:8080 not flagged"
exposed 127.0.0.1:8080 gateway && fail "gateway on 127.0.0.1:8080 flagged"
exposed "[::1]:8080" gateway && fail "gateway on [::1]:8080 flagged"
exposed 80 10.0.0.5 && fail "a remote proxy's address on port 80 flagged"
exposed 80 "" && fail "empty TRUST_PROXY flagged"

# End to end: an ssh option given as a host stops the script before ssh runs.
marker="$work/proxycommand-ran"
out=$(bash "$here/deploy.sh" status --yes --host "-oProxyCommand=touch $marker" 2>&1) && fail "--host -oProxyCommand: exit 0"
[ -e "$marker" ] && fail "--host -oProxyCommand: ssh ran the ProxyCommand"
printf '%s' "$out" | grep -q 'not a host' || fail "--host -oProxyCommand: no 'not a host' message: $out"

printf '%s\n' "# a comment" "-oProxyCommand=touch\${IFS}$marker" > "$work/servers.txt"
out=$(bash "$here/deploy.sh" status --yes --servers "$work/servers.txt" 2>&1) && fail "servers file -oProxyCommand: exit 0"
[ -e "$marker" ] && fail "servers file -oProxyCommand: ssh ran the ProxyCommand"
printf '%s' "$out" | grep -q 'not a host' || fail "servers file -oProxyCommand: no 'not a host' message: $out"

# --- Actions against a fake docker -------------------------------------------------------------
# A copy of the checkout with docker and curl replaced: docker logs its arguments (and any stdin to
# db) and answers what the action asks; curl answers the health check. Nothing reaches a real daemon.
repo="$work/repo"; bin="$work/bin"
mkdir -p "$repo/deploy" "$bin"
cp "$here/deploy.sh" "$repo/deploy/deploy.sh"
cp "$here/../compose.yaml" "$here/../.env.example" "$repo/"
cat > "$bin/docker" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${FAKE_DIR:?}/docker.log"
case "$*" in
  "compose version --short") echo "2.30.0"; exit 0 ;;
  "info --format {{.OSType}}") echo "linux"; exit 0 ;;
  *"volume ls"*) cat "$FAKE_DIR/volumes" 2>/dev/null; exit 0 ;;
  *"compose"*" config"*) echo "name: ta-test"; exit 0 ;;
  *"compose"*" ps "*) echo "c0ffee"; exit 0 ;;
  *"exec -T api node dist/firmwareCli.js"*) { echo "--- $*"; cat; } >> "$FAKE_DIR/fw.stdin"; exit "$(cat "$FAKE_DIR/fw.rc" 2>/dev/null || echo 0)" ;;
  *"exec -T api node -e"*) cat "$FAKE_DIR/rotation.out" 2>/dev/null; exit "$(cat "$FAKE_DIR/rotation.rc" 2>/dev/null || echo 0)" ;;
  *"exec -T db sh -c"*"mysqldump"*) printf -- '-- dump\n-- Dump completed\n'; exit 0 ;;
  *"exec -T db sh -c"*) { echo "--- $*"; cat; } >> "$FAKE_DIR/db.stdin"; exit "$(cat "$FAKE_DIR/db.rc" 2>/dev/null || echo 0)" ;;
esac
exit 0
FAKE
cat > "$bin/curl" <<'FAKE'
#!/usr/bin/env bash
echo '{"status":"ok"}'
FAKE
chmod +x "$bin/docker" "$bin/curl"
export FAKE_DIR="$work"
run_fake() { (cd "$repo" && PATH="$bin:$PATH" bash deploy/deploy.sh "$@" --yes 2>&1); }
renv() { grep -E "^$1=" "$repo/.env" | tail -n 1 | cut -d= -f2-; }
set_env() { sed -i "s/^$1=.*/$1=$2/" "$repo/.env"; }
hex64() { printf '%s' "$1" | grep -Eq '^[0-9a-f]{64}$'; }
reset_fake() { rm -f "$work/docker.log" "$work/db.stdin" "$work/rotation.out" "$work/rotation.rc" "$work/db.rc" "$work/volumes"; }

# install: four secrets from the CSPRNG, all different; info masks every one of them.
reset_fake
out=$(run_fake install --web-port 18098) || fail "install: exit $?: $out"
for k in ADMIN_TOKEN DEVICE_TOKEN DB_PASSWORD DB_ROOT_PASSWORD; do hex64 "$(renv $k)" || fail "install: $k is not 64 hex characters"; done
[ "$(for k in ADMIN_TOKEN DEVICE_TOKEN DB_PASSWORD DB_ROOT_PASSWORD; do renv $k; echo; done | sort -u | grep -c .)" = 4 ] || fail "install: the four secrets are not all different"
out=$(run_fake info)
for k in ADMIN_TOKEN DEVICE_TOKEN DB_PASSWORD DB_ROOT_PASSWORD; do
  printf '%s' "$out" | grep -qF "$(renv $k)" && fail "info: $k printed in full without --reveal"
done
printf '%s' "$out" | grep -q 'DB root' || fail "info: no DB root line: $out"

# Email notifications (docs/adr/0008). Off after a plain install: no SMTP setting has a value, since
# one set without SMTP_HOST stops api from starting. Compose passes every one to api, empty when unset.
for k in SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASSWORD NOTIFY_FROM NOTIFY_TO PUBLIC_URL NOTIFY_COALESCE_SECONDS; do
  [ -z "$(renv $k)" ] || fail "install: $k has a value without --smtp-host"
  grep -qE "^      $k: \\\$\{$k:-\}\$" "$repo/compose.yaml" || fail "compose.yaml: api does not get $k (empty when unset)"
  grep -qE "^# $k=" "$repo/.env.example" || fail ".env.example: $k is not listed, commented"
done
printf '%s' "$out" | grep -q 'Email *off' || fail "info: notifications not shown as off: $out"

# The password is never an argument: --smtp-password is refused before anything is written.
cp "$repo/.env" "$work/env.before"
out=$(run_fake install --reconfigure --smtp-host relay.example.org --smtp-password hunter2 < /dev/null) && fail "--smtp-password: exit 0"
printf '%s' "$out" | grep -q 'never taken on the command line' || fail "--smtp-password: no explanation: $out"
cmp -s "$repo/.env" "$work/env.before" || fail "--smtp-password: .env changed"

# Half a group, or a bad value, is refused naming the flag, and .env is left as it was.
out=$(run_fake install --reconfigure --smtp-host relay.example.org --notify-from alarms@example.org --notify-to techs@example.org < /dev/null) && fail "no --public-url: exit 0"
printf '%s' "$out" | grep -q -- '--public-url is required' || fail "no --public-url: no explanation: $out"
ok_flags=(--smtp-host relay.example.org --notify-from alarms@example.org --notify-to techs@example.org --public-url https://alarms.example.org)
for bad in "--smtp-port 70000" "--smtp-secure ssl" "--notify-to not-an-address" "--notify-from a@b.c,d@e.f" "--public-url ftp://alarms.example.org" "--smtp-host relay.example.org;id"; do
  # shellcheck disable=SC2086 # one flag and its value
  out=$(run_fake install --reconfigure "${ok_flags[@]}" $bad < /dev/null) && fail "$bad: exit 0"
  printf '%s' "$out" | grep -q -- "${bad%% *}" || fail "$bad: the flag is not named: $out"
done
out=$(run_fake install --reconfigure "${ok_flags[@]}" --notify-to "$(printf 'a@example.org\nADMIN_TOKEN=x')" < /dev/null) && fail "a second line in --notify-to: exit 0"
printf '%s\n' "it's" | run_fake install --reconfigure "${ok_flags[@]}" --smtp-user svc > /dev/null && fail "a password with a single quote: exit 0"
cmp -s "$repo/.env" "$work/env.before" || fail "refused settings: .env changed"

# On, with a login: the password arrives as the first line of stdin, is written single-quoted (Compose
# takes it literally, $ and # included), and is on no docker command line and in no output.
# shellcheck disable=SC2016 # a literal $, which Compose must not expand either
pw='p@ss $HOME #1 \t\\x "q"'
out=$(printf '%s\r\n' "$pw" | run_fake install --reconfigure "${ok_flags[@]}" --smtp-port 465 --smtp-secure tls --smtp-user 'DISTRICT\svc-alarms' --notify-to 'techs@example.org, noc@example.org') || fail "notify on: exit $?: $out"
[ "$(renv SMTP_HOST)" = relay.example.org ] || fail "notify on: SMTP_HOST is '$(renv SMTP_HOST)'"
[ "$(renv SMTP_PORT)" = 465 ] && [ "$(renv SMTP_SECURE)" = tls ] || fail "notify on: port or security not written"
[ "$(renv SMTP_USER)" = 'DISTRICT\svc-alarms' ] || fail "notify on: SMTP_USER is '$(renv SMTP_USER)'"
[ "$(renv SMTP_PASSWORD)" = "'$pw'" ] || fail "notify on: SMTP_PASSWORD is not the stdin line, single-quoted: $(renv SMTP_PASSWORD)"
[ "$(renv NOTIFY_TO)" = techs@example.org,noc@example.org ] || fail "notify on: NOTIFY_TO is '$(renv NOTIFY_TO)'"
[ "$(renv PUBLIC_URL)" = https://alarms.example.org ] || fail "notify on: PUBLIC_URL is '$(renv PUBLIC_URL)'"
for k in ADMIN_TOKEN DEVICE_TOKEN DB_PASSWORD DB_ROOT_PASSWORD; do
  [ "$(renv $k)" = "$(grep -E "^$k=" "$work/env.before" | cut -d= -f2-)" ] || fail "notify on: $k changed"
done
printf '%s' "$out" | grep -qF "$pw" && fail "notify on: the password is in the output"
grep -qF 'p@ss' "$work/docker.log" 2>/dev/null && fail "notify on: the password is on a docker command line"
# info masks the password whole, not first-and-last-four like the hex secrets; --reveal shows it.
out=$(run_fake info)
printf '%s' "$out" | grep -q 'relay.example.org:465 (tls)' || fail "info: no relay line: $out"
printf '%s' "$out" | grep -qF 'DISTRICT\svc-alarms / ********' || fail "info: no masked login line: $out"
printf '%s' "$out" | grep -qF 'p@ss' && fail "info: the SMTP password (or its start) printed without --reveal"
out=$(run_fake info --reveal)
printf '%s' "$out" | grep -qF "$pw" || fail "info --reveal: the SMTP password not shown: $out"

# One setting changes on its own; with --smtp-user again and nothing on stdin, the password is kept.
out=$(run_fake install --reconfigure --notify-to oncall@example.org < /dev/null) || fail "notify-to alone: exit $?: $out"
[ "$(renv NOTIFY_TO)" = oncall@example.org ] && [ "$(renv SMTP_HOST)" = relay.example.org ] || fail "notify-to alone: not applied on its own"
out=$(run_fake install --reconfigure --smtp-user other-svc < /dev/null) || fail "smtp-user, empty stdin: exit $?: $out"
[ "$(renv SMTP_USER)" = other-svc ] && [ "$(renv SMTP_PASSWORD)" = "'$pw'" ] || fail "smtp-user, empty stdin: password not kept"
# Without --reconfigure an existing .env is left alone, as for --set.
out=$(run_fake install --smtp-host off < /dev/null) || fail "off without --reconfigure: exit $?"
[ "$(renv SMTP_HOST)" = relay.example.org ] || fail "off without --reconfigure: .env changed"

# Off: every setting of the group is emptied, so none is left set without SMTP_HOST.
out=$(run_fake install --reconfigure --smtp-host off < /dev/null) || fail "off: exit $?: $out"
for k in SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASSWORD NOTIFY_FROM NOTIFY_TO PUBLIC_URL; do
  [ -z "$(renv $k)" ] || fail "off: $k still set"
done
out=$(run_fake install --reconfigure --smtp-host off --notify-to a@example.org < /dev/null) && fail "off with another flag: exit 0"
# A relay that needs no login, on a fresh .env: no user, no password.
mv "$repo/.env" "$work/env.kept"
out=$(run_fake install "${ok_flags[@]}" < /dev/null) || fail "fresh install with notify: exit $?: $out"
[ "$(renv SMTP_HOST)" = relay.example.org ] && [ -z "$(renv SMTP_USER)" ] && [ -z "$(renv SMTP_PASSWORD)" ] || fail "fresh install with notify: wrong group"
hex64 "$(renv ADMIN_TOKEN)" || fail "fresh install with notify: no secrets"
mv "$work/env.kept" "$repo/.env"
# Remote: the password is read here once and reaches the server on ssh's stdin, never in its arguments.
cat > "$bin/ssh" <<'FAKE'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${FAKE_DIR:?}/ssh.args"
cat >> "$FAKE_DIR/ssh.stdin"
FAKE
chmod +x "$bin/ssh"
rm -f "$work/ssh.args" "$work/ssh.stdin"
out=$(printf '%s\n' "$pw" | run_fake install --reconfigure --smtp-user svc --host admin@a.example.org --host admin@b.example.org) || fail "remote smtp-user: exit $?: $out"
[ "$(grep -cxF -- "$pw" "$work/ssh.stdin" 2>/dev/null)" = 2 ] || fail "remote smtp-user: the password did not reach both servers on stdin"
grep -qF 'p@ss' "$work/ssh.args" && fail "remote smtp-user: the password is in ssh's arguments"
rm -f "$bin/ssh"

# rotate-device-token: the current token moves to DEVICE_TOKEN_PREVIOUS, a new one is generated,
# the stack is recreated, and the config.h line is masked unless --reveal.
reset_fake
old=$(renv DEVICE_TOKEN)
out=$(run_fake rotate-device-token) || fail "rotate: exit $?: $out"
new=$(renv DEVICE_TOKEN)
[ "$(renv DEVICE_TOKEN_PREVIOUS)" = "$old" ] || fail "rotate: DEVICE_TOKEN_PREVIOUS is not the old token"
{ hex64 "$new" && [ "$new" != "$old" ]; } || fail "rotate: DEVICE_TOKEN is not a new 64-hex token"
grep -q ' up -d' "$work/docker.log" || fail "rotate: the stack was not recreated"
printf '%s' "$out" | grep -q '#define DEVICE_TOKEN "' || fail "rotate: no config.h line: $out"
printf '%s' "$out" | grep -qF "$new" && fail "rotate: the new token printed without --reveal"
printf '%s' "$out" | grep -q 'rotate-device-token --finish' || fail "rotate: the steps do not say how to finish"
grep -qF "$old" "$work/docker.log" && fail "rotate: the old token is on a docker command line"
grep -qF "$new" "$work/docker.log" && fail "rotate: the new token is on a docker command line"

# A second rotation before --finish would strand the boards on the oldest token.
out=$(run_fake rotate-device-token --reveal) && fail "rotate twice: exit 0"
{ [ "$(renv DEVICE_TOKEN)" = "$new" ] && [ "$(renv DEVICE_TOKEN_PREVIOUS)" = "$old" ]; } || fail "rotate twice: .env changed"
printf '%s' "$out" | grep -q 'already under way' || fail "rotate twice: no explanation: $out"

# --finish refuses while api lists Devices on the previous token, naming them.
reset_fake
printf 'previous ESP_00000A\nunheard ESP_00000C\n' > "$work/rotation.out"; echo 3 > "$work/rotation.rc"
out=$(run_fake rotate-device-token --finish) && fail "finish with Devices left: exit 0"
[ "$(renv DEVICE_TOKEN_PREVIOUS)" = "$old" ] || fail "finish with Devices left: the previous token was cleared"
{ printf '%s' "$out" | grep -q 'ESP_00000A' && printf '%s' "$out" | grep -q 'ESP_00000C'; } || fail "finish with Devices left: not named: $out"
grep -q ' up -d' "$work/docker.log" && fail "finish with Devices left: the stack was recreated"
# --force needs the typed confirmation.
out=$(run_fake rotate-device-token --finish --force) && fail "finish --force without --confirm: exit 0"
[ "$(renv DEVICE_TOKEN_PREVIOUS)" = "$old" ] || fail "finish --force without --confirm: cleared"
out=$(run_fake rotate-device-token --finish --force --confirm ta-test) || fail "finish --force --confirm: exit $?: $out"
[ -z "$(renv DEVICE_TOKEN_PREVIOUS)" ] || fail "finish --force --confirm: not cleared"

# --finish once the list is empty clears it and recreates the stack; the token stays the new one.
set_env DEVICE_TOKEN_PREVIOUS "$old"
reset_fake; : > "$work/rotation.out"; echo 0 > "$work/rotation.rc"
out=$(run_fake rotate-device-token --finish) || fail "finish: exit $?: $out"
[ -z "$(renv DEVICE_TOKEN_PREVIOUS)" ] || fail "finish: DEVICE_TOKEN_PREVIOUS not cleared"
[ "$(renv DEVICE_TOKEN)" = "$new" ] || fail "finish: DEVICE_TOKEN changed"
grep -q ' up -d' "$work/docker.log" || fail "finish: the stack was not recreated"
grep -q 'exec -T api node -e' "$work/docker.log" || fail "finish: api was not asked for the list"
grep -qF "$(renv ADMIN_TOKEN)" "$work/docker.log" && fail "finish: the Admin token is on a docker command line"
# api unreachable: never cleared on a guess.
set_env DEVICE_TOKEN_PREVIOUS "$old"
reset_fake; echo 'GET /api/devices/rotation answered 500' > "$work/rotation.out"; echo 1 > "$work/rotation.rc"
out=$(run_fake rotate-device-token --finish) && fail "finish with api failing: exit 0"
[ "$(renv DEVICE_TOKEN_PREVIOUS)" = "$old" ] || fail "finish with api failing: cleared"
set_env DEVICE_TOKEN_PREVIOUS ""

# An install from before DB_ROOT_PASSWORD (its volume made by master): install leaves root's password
# alone, other actions still work, deploy explains and needs the typed confirmation, then moves root
# over with the SQL and the new password on stdin.
reset_fake
sed -i '/^DB_ROOT_PASSWORD=/d' "$repo/.env"
echo ta-test_db-data > "$work/volumes"
out=$(run_fake install) || fail "legacy install: exit $?: $out"
[ -z "$(renv DB_ROOT_PASSWORD)" ] || fail "legacy install: generated a DB_ROOT_PASSWORD the volume does not have"
out=$(run_fake backup) || fail "legacy backup: exit $?: $out"
printf '%s' "$out" | grep -q 'still shares DB_PASSWORD' || fail "legacy backup: no warning: $out"
rm -rf "$repo/backups"
out=$(run_fake deploy --no-pull) && fail "legacy deploy without --confirm: exit 0"
printf '%s' "$out" | grep -qF "DROP USER IF EXISTS 'root'@'%'" || fail "legacy deploy: no explanation: $out"
[ -z "$(renv DB_ROOT_PASSWORD)" ] || fail "legacy deploy without --confirm: .env changed"
[ -e "$work/db.stdin" ] && fail "legacy deploy without --confirm: ran SQL"
echo 1 > "$work/db.rc"
out=$(run_fake deploy --no-pull --confirm ta-test) && fail "legacy deploy, MySQL refusing: exit 0"
[ -z "$(renv DB_ROOT_PASSWORD)" ] || fail "legacy deploy, MySQL refusing: .env keeps a password root does not have"
reset_fake; echo ta-test_db-data > "$work/volumes"
out=$(run_fake deploy --no-pull --confirm ta-test) || fail "legacy deploy: exit $?: $out"
root=$(renv DB_ROOT_PASSWORD)
hex64 "$root" || fail "legacy deploy: DB_ROOT_PASSWORD not written"
[ "$root" != "$(renv DB_PASSWORD)" ] || fail "legacy deploy: root still shares DB_PASSWORD"
grep -qF "DROP USER IF EXISTS 'root'@'%';" "$work/db.stdin" || fail "legacy deploy: root@'%' not dropped"
grep -qF "ALTER USER 'root'@'localhost' IDENTIFIED BY '$root';" "$work/db.stdin" || fail "legacy deploy: root's password not set"
grep -qF "$root" "$work/docker.log" && fail "legacy deploy: the root password is on a docker command line"
grep -q 'mysqldump' "$work/docker.log" || fail "legacy deploy: no backup before the change"
# And once moved over, deploy leaves it alone.
reset_fake; echo ta-test_db-data > "$work/volumes"
out=$(run_fake deploy --no-pull) || fail "deploy after the move: exit $?: $out"
[ -e "$work/db.stdin" ] && fail "deploy after the move: ran SQL again"
[ "$(renv DB_ROOT_PASSWORD)" = "$root" ] || fail "deploy after the move: DB_ROOT_PASSWORD changed"

# publish-firmware: the image reaches api as base64 on stdin, never as a file path or an argument;
# --only is passed through and checked; status and withdraw call the same tool.
reset_fake; rm -f "$work/fw.stdin" "$work/fw.rc"
head -c 4096 /dev/urandom > "$work/fw.bin.signed"
out=$(run_fake publish-firmware) && fail "publish-firmware without --file: exit 0"
printf '%s' "$out" | grep -q -- '--file' || fail "publish-firmware without --file: no hint: $out"
out=$(run_fake publish-firmware --file "$work/fw.bin.signed" --only 'ESP_A1B2C3;id') && fail "publish-firmware with a bad --only: exit 0"
[ -e "$work/fw.stdin" ] && fail "publish-firmware with a bad --only: sent the image"
out=$(run_fake publish-firmware --file "$work/fw.bin.signed" --only ESP_A1B2C3,ESP_D4E5F6) || fail "publish-firmware: exit $?: $out"
grep -q -- '--- compose exec -T api node dist/firmwareCli.js publish --only ESP_A1B2C3,ESP_D4E5F6' "$work/fw.stdin" || fail "publish-firmware: wrong command: $(head -n 1 "$work/fw.stdin")"
sed '1d' "$work/fw.stdin" | base64 -d | cmp -s - "$work/fw.bin.signed" || fail "publish-firmware: the image did not arrive intact on stdin"
printf '%s' "$out" | grep -q 'without --only' || fail "publish-firmware --only: no next step"
echo 1 > "$work/fw.rc"
out=$(run_fake publish-firmware --file "$work/fw.bin.signed") && fail "publish-firmware refused by api: exit 0"
rm -f "$work/fw.stdin" "$work/fw.rc"
run_fake firmware-status > /dev/null || fail "firmware-status: exit $?"
run_fake withdraw-firmware > /dev/null || fail "withdraw-firmware: exit $?"
{ grep -q 'firmwareCli.js status' "$work/fw.stdin" && grep -q 'firmwareCli.js withdraw' "$work/fw.stdin"; } || fail "status/withdraw: not run in api"

if [ "$fails" -eq 0 ]; then echo "deploy.test.sh: all passed"; else echo "deploy.test.sh: $fails failed"; exit 1; fi
