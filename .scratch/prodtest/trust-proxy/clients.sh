#!/usr/bin/env bash
# Runs streams.mjs from client containers on the ta-tp network, each with its own address, at once.
#   clients.sh LABEL "NAME URL N [XFF|rotate]" ...
set -u
export MSYS_NO_PATHCONV=1
DIR=$(cd "$(dirname "$0")" && { pwd -W 2>/dev/null || pwd; })
shift  # LABEL, for the log only

for spec in "$@"; do
  # shellcheck disable=SC2086  # NAME URL N [XFF] split on purpose
  set -- $spec
  name=$1; shift
  docker run --rm --name "ta-tp-client-$name" --network ta-tp_default --memory 96m -e CLIENT="$name" \
    -v "$DIR/streams.mjs:/streams.mjs:ro" node:22-alpine node /streams.mjs "$@" &
done
wait
