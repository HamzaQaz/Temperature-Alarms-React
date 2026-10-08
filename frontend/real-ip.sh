#!/bin/sh
# Runs from the nginx image's entrypoint (/docker-entrypoint.d) before nginx starts. Writes
# /tmp/real-ip.conf, which nginx.conf includes in its server block.
#
# TRUST_PROXY empty (the default): an empty file, so nginx keys its stream cap on the address
# it sees and the api gets that address, as before. Behind a TLS proxy that is the proxy, for
# every browser at once (DEPLOYMENT.md, TLS in front of the stack).
#
# TRUST_PROXY set: a comma-separated list of the front proxy's addresses or CIDR ranges, or the
# word `gateway` for this container's default gateway, which is where a proxy on the Docker host
# arrives from. nginx then takes the client from X-Forwarded-For, but only on requests from those
# addresses, and walks the header from the right past each trusted entry, so a value a client
# wrote itself is never believed. $remote_addr, the stream cap, the access log, and the
# X-Forwarded-For sent to the api all become the browser's address.
#
# /tmp, because the container's root filesystem is read-only (compose.yaml mounts a tmpfs there).
# A value that is not an address stops the container, rather than starting with a guess.
set -eu
# The unquoted splits below must never expand a `*` in TRUST_PROXY into file names.
set -f

# REAL_IP_CONF: only for real-ip.test.sh.
out=${REAL_IP_CONF:-/tmp/real-ip.conf}
log() { echo "real-ip: $*" >&2; }

# The default route's gateway, from the kernel's routing table (little-endian hex).
default_gateway() {
  hex=$(awk '$2 == "00000000" { print $3; exit }' /proc/net/route)
  [ -n "$hex" ] || return 1
  printf '%d.%d.%d.%d' "0x${hex#??????}" "0x$(printf '%s' "$hex" | cut -c5-6)" \
    "0x$(printf '%s' "$hex" | cut -c3-4)" "0x${hex%??????}"
}

valid_ipv4() {
  case "$1" in *[!0-9.]*|.*|*.|*..*) return 1 ;; esac
  old_ifs=$IFS; IFS=.
  # shellcheck disable=SC2086 # split on the dots, on purpose; set -f above stops any globbing
  set -- $1
  IFS=$old_ifs
  [ $# -eq 4 ] || return 1
  for octet; do
    case "$octet" in ????*) return 1 ;; esac
    [ "$octet" -le 255 ] || return 1
  done
}

# Groups of up to four hex digits, eight of them, or fewer around one `::`; the last two may be
# a dotted IPv4 address. No zone (%eth0) and no brackets: nginx takes neither here.
valid_ipv6() {
  a=$1
  case "$a" in *:*) ;; *) return 1 ;; esac
  case "$a" in *[!0-9A-Fa-f:.]*|*:::*|*::*::*) return 1 ;; esac
  case "$a" in *.*) valid_ipv4 "${a##*:}" || return 1; a="${a%:*}:0:0" ;; esac
  case "$a" in *.*) return 1 ;; esac
  case "$a" in *::*) compressed=1 ;; *) compressed=0 ;; esac
  old_ifs=$IFS; IFS=:
  # shellcheck disable=SC2086 # split on the colons, on purpose; set -f above stops any globbing
  set -- $a
  IFS=$old_ifs
  groups=0
  for group; do
    if [ -z "$group" ]; then [ "$compressed" -eq 1 ] || return 1; continue; fi
    case "$group" in ?????*) return 1 ;; esac
    groups=$((groups + 1))
  done
  if [ "$compressed" -eq 1 ]; then [ "$groups" -le 7 ]; else [ "$groups" -eq 8 ]; fi
}

# An address, or ADDRESS/PREFIX with the prefix 1 to 32 (IPv4) or 1 to 128 (IPv6). Never a prefix
# of 0, however it is spelled (/0, /00): every address, so anyone could write their own X-Forwarded-For.
valid_address() {
  case "$1" in
    */*/*) return 1 ;;
    */*) addr=${1%/*}; prefix=${1#*/} ;;
    *) addr=$1; prefix="" ;;
  esac
  if valid_ipv4 "$addr"; then max=32
  elif valid_ipv6 "$addr"; then max=128
  else return 1
  fi
  case "$1" in */*) ;; *) return 0 ;; esac
  case "$prefix" in ''|*[!0-9]*|????*) return 1 ;; esac
  [ "$prefix" -ge 1 ] && [ "$prefix" -le "$max" ]
}

lines=""
list=$(printf '%s' "${TRUST_PROXY:-}" | tr ',' ' ')
for entry in $list; do
  if [ "$entry" = gateway ]; then
    entry=$(default_gateway) || { log "TRUST_PROXY=gateway, but this container has no default route"; exit 1; }
  elif ! valid_address "$entry"; then
    log "TRUST_PROXY: '$entry' is not an IP address or CIDR range (and /0 is refused)"
    exit 1
  fi
  lines="${lines}set_real_ip_from $entry;
"
done

{
  # Only validated entries reach this file; the raw value never does, newlines and all.
  echo "# Written by /docker-entrypoint.d/15-real-ip.sh from TRUST_PROXY."
  if [ -n "$lines" ]; then
    printf '%s' "$lines"
    echo "real_ip_header X-Forwarded-For;"
    echo "real_ip_recursive on;"
  fi
} > "$out"

if [ -n "$lines" ]; then
  log "client address taken from X-Forwarded-For on requests from: $(printf '%s' "$lines" | sed 's/set_real_ip_from //; s/;//' | tr '\n' ' ')"
else
  log "TRUST_PROXY is empty; client address is the connecting address"
fi
