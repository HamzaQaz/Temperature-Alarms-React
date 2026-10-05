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

out=/tmp/real-ip.conf
log() { echo "real-ip: $*" >&2; }

# The default route's gateway, from the kernel's routing table (little-endian hex).
default_gateway() {
  hex=$(awk '$2 == "00000000" { print $3; exit }' /proc/net/route)
  [ -n "$hex" ] || return 1
  printf '%d.%d.%d.%d' "0x${hex#??????}" "0x$(printf '%s' "$hex" | cut -c5-6)" \
    "0x$(printf '%s' "$hex" | cut -c3-4)" "0x${hex%??????}"
}

valid_address() {
  case "$1" in
    */0) return 1 ;;  # every address: anyone could write their own X-Forwarded-For
  esac
  printf '%s' "$1" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}(/[0-9]{1,2})?$' && return 0
  printf '%s' "$1" | grep -Eq '^[0-9A-Fa-f:]*:[0-9A-Fa-f:.]*(/[0-9]{1,3})?$'
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
  echo "# Written by /docker-entrypoint.d/15-real-ip.sh from TRUST_PROXY='${TRUST_PROXY:-}'."
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
