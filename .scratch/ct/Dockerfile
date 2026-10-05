# A stand-in for a fresh Proxmox debian-12 CT: systemd as PID 1, sudo, ssh, curl,
# locales, and an `admin` login with passwordless sudo. No Docker, no git: the
# deploy script's `bootstrap` has to install those itself.
FROM debian:12
ENV container=docker DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends systemd systemd-sysv dbus sudo openssh-server curl ca-certificates locales procps iproute2 \
 && sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen && locale-gen \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -m -s /bin/bash admin \
 && echo 'admin ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/admin && chmod 440 /etc/sudoers.d/admin \
 && systemctl enable ssh \
 && rm -f /lib/systemd/system/multi-user.target.wants/getty* /etc/systemd/system/getty.target.wants/*
ENV LANG=en_US.UTF-8
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
