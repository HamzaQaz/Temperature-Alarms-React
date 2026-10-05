#!/usr/bin/env bash
# Build and start the CT stand-in for a fresh Proxmox debian-12 LXC.
# Run from anywhere (Git Bash on Windows is fine):
#   .scratch/ct/run.sh          build the image and start ta-ct
#   .scratch/ct/run.sh down     stop and remove ta-ct, its image, and its volumes
set -euo pipefail
cd "$(dirname "$0")"
if [ "${1:-}" = down ]; then
  docker rm -f ta-ct 2>/dev/null || true
  docker volume rm ta-ct-docker ta-ct-containerd 2>/dev/null || true
  docker image rm ta-ct 2>/dev/null || true
  exit 0
fi
docker build -t ta-ct .
# The brief's command, with two additions:
#  - ta-ct-docker and ta-ct-containerd: the nested Docker's image stores on an
#    ext4-backed volume. Docker Desktop gives a container an overlayfs root, and
#    overlayfs cannot stack on overlayfs ("mount ... fstype: overlay ... invalid
#    argument" on the first `docker run`). A Proxmox CT's root is ext4 (LVM-thin,
#    directory) or ZFS, so this is what a real CT already has.
#  - 8091 published for the demo stack.
# MSYS_NO_PATHCONV stops Git Bash rewriting /sys/fs/cgroup into a Windows path.
MSYS_NO_PATHCONV=1 docker run -d --privileged --cgroupns=host \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock \
  -v ta-ct-docker:/var/lib/docker -v ta-ct-containerd:/var/lib/containerd \
  -p 8090:80 -p 8091:8091 --name ta-ct --hostname ta-ct ta-ct /sbin/init
