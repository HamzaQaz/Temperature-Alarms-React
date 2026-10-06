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

if [ "$fails" -eq 0 ]; then echo "deploy.test.sh: all passed"; else echo "deploy.test.sh: $fails failed"; exit 1; fi
