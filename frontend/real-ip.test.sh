#!/bin/sh
# Tests for real-ip.sh, the TRUST_PROXY gate in front of nginx's real_ip. Runs anywhere with a
# POSIX sh (Git Bash too): sh frontend/real-ip.test.sh. Exits non-zero on the first failure.
# Every refused value must stop the script (exit 1) and must leave no config behind that trusts it.
set -u

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fails=0

run() {
  rm -f "$work/real-ip.conf"
  TRUST_PROXY=$1 REAL_IP_CONF="$work/real-ip.conf" sh "$here/real-ip.sh" 2>"$work/err"
}

accepts() {
  if run "$1"; then
    grep -q "^set_real_ip_from $2;\$" "$work/real-ip.conf" || { echo "FAIL accepts '$1': no 'set_real_ip_from $2;'"; cat "$work/real-ip.conf"; fails=$((fails + 1)); }
  else
    echo "FAIL accepts '$1': refused: $(cat "$work/err")"; fails=$((fails + 1))
  fi
}

refuses() {
  if run "$1"; then
    echo "FAIL refuses '$1': accepted:"; cat "$work/real-ip.conf"; fails=$((fails + 1))
  elif [ -e "$work/real-ip.conf" ] && grep -q set_real_ip_from "$work/real-ip.conf"; then
    echo "FAIL refuses '$1': exited, but left a config trusting it"; fails=$((fails + 1))
  fi
}

# Empty: no real_ip at all.
run "" || { echo "FAIL empty: refused"; fails=$((fails + 1)); }
grep -q real_ip "$work/real-ip.conf" && { echo "FAIL empty: wrote real_ip directives"; fails=$((fails + 1)); }

accepts 10.0.0.5 10.0.0.5
accepts 172.22.0.0/16 172.22.0.0/16
accepts " 10.0.0.5 , 10.0.0.6 " 10.0.0.6
accepts 2001:db8::/32 2001:db8::/32
accepts fd00::1 fd00::1
accepts ::ffff:10.0.0.5 ::ffff:10.0.0.5

# Every address, in any spelling: anyone could write their own X-Forwarded-For.
for v in 0.0.0.0/0 1.2.3.4/0 1.2.3.4/00 0.0.0.0/000 ::/0 ::/00 ::/000 2001:db8::/0000; do refuses "$v"; done
# Prefixes nginx would read differently, or not at all.
for v in 1.2.3.4/33 1.2.3.4/99 ::/129 ::/999 1.2.3.4/ 1.2.3.4/-1; do refuses "$v"; done
# Not addresses: hostnames, octets out of range, nginx or shell syntax.
# shellcheck disable=SC2016 # literal payloads, never expanded
for v in caddy proxy.example.com 256.1.1.1 1.2.3 '1.2.3.4;' '1.2.3.4; set_real_ip_from 0.0.0.0/0' \
  '$(id)' '`id`' '1.2.3.4|id' '*' '/*' "1.2.3.4'" '::1%eth0' '[::1]' ':' 'gateway;'; do
  refuses "$v"
done

# A newline is a separator to the split, never a way to a second config line.
refuses "$(printf '10.0.0.5\nreal_ip_header X-Real-IP;')"
if run "$(printf '10.0.0.5\n10.0.0.6')"; then
  # The comment line names only what was validated, so no raw value reaches the file.
  if grep -v '^#' "$work/real-ip.conf" | grep -Ev '^(set_real_ip_from [0-9.]+;|real_ip_header X-Forwarded-For;|real_ip_recursive on;)$' | grep -q .; then
    echo "FAIL newline: an unexpected line reached the config:"; cat "$work/real-ip.conf"; fails=$((fails + 1))
  fi
fi

if [ "$fails" -eq 0 ]; then echo "real-ip.test.sh: all passed"; else echo "real-ip.test.sh: $fails failed"; exit 1; fi
