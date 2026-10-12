#!/usr/bin/env bash
#
# Blind Luck Poker — one-time preparation of an Oracle Cloud Always Free VM (Ubuntu 24.04 on an ARM
# `VM.Standard.A1.Flex`) for the Normal edition's Compose stack.
#
#     sudo ./bootstrap.sh <REPO_URL> [BRANCH]
#     curl -fsSL <raw-url-of-this-file> | sudo bash -s -- <REPO_URL> main
#
# `BRANCH` defaults to `main`.
#
# Six things, and nothing else. It never starts the stack, never writes a `.env` and never touches
# DNS, because each of those needs a secret or a decision this script has no business making:
#
#   1. iptables: accept tcp/80 and tcp/443, inserted *above* the image's default REJECT, and saved.
#   2. A 2 GB swapfile, if the machine has no swap at all. 8 GB of RAM runs this stack comfortably
#      and builds its image only just — `pnpm install` plus tsc plus vite inside the builder stage
#      is the peak, and an out-of-memory kill there is the failure this step exists to prevent.
#   3. Docker Engine and the Compose v2 plugin, from Docker's own apt repository (the `docker.io`
#      package in Ubuntu's archive has no Compose v2 plugin, which is what the stack is written for).
#   4. The login user in the `docker` group.
#   5. unattended-upgrades, enabled.
#   6. The repository, cloned to /opt/bind-poker — or brought up to date if it is already there.
#
# **Re-running it is safe, and is the intended way to bring the machine forward.** Every step looks
# at the world before touching it and prints either what it did or why it did not.
#
# The runbook — everything that happens before this script (an account, a VM, a Security List) and
# everything after it (`.env`, DNS, the first ARM image build, backups) — is README.md beside it.

set -euo pipefail

# ---------------------------------------------------------------------------- parameters

REPO_URL="${1:-}"
BRANCH="${2:-main}"

# Oracle's Ubuntu images log you in as `ubuntu`; this is the account that will own the checkout and
# run `docker compose`. It is an environment variable rather than a third positional argument
# because changing it is an escape hatch for a non-Oracle host, not part of the normal call.
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"

CHECKOUT_DIR=/opt/bind-poker
SWAP_FILE=/swapfile
SWAP_MB=2048   # megabytes, so that `fallocate` and the `dd` fallback below cannot drift apart
AUTO_UPGRADE_CONF=/etc/apt/apt.conf.d/20auto-upgrades
DOCKER_KEY=/etc/apt/keyrings/docker.asc
DOCKER_LIST=/etc/apt/sources.list.d/docker.list

# ---------------------------------------------------------------------------- output

step() { printf '\n=== %s\n' "$*"; }
did()  { printf '  [done] %s\n' "$*"; }
skip() { printf '  [skip] %s\n' "$*"; }
die()  { printf 'bootstrap: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------- preconditions

[ -n "$REPO_URL" ] || die "usage: sudo $0 <REPO_URL> [BRANCH]   — BRANCH defaults to main"
[ "$(id -u)" -eq 0 ] || die "must run as root: sudo $0 $REPO_URL $BRANCH"
command -v apt-get >/dev/null 2>&1 || die "this script is for Ubuntu/Debian — no apt-get here"
id -u "$DEPLOY_USER" >/dev/null 2>&1 ||
  die "no user '$DEPLOY_USER' on this machine; if the image's login account is named something else, re-run with DEPLOY_USER=<name> sudo -E $0 …"

# `apt-get update` once per run, however many steps turn out to need a package.
APT_UPDATED=0
apt_update_once() {
  if [ "$APT_UPDATED" -eq 0 ]; then
    apt-get update -qq
    APT_UPDATED=1
  fi
}

# `DEBIAN_FRONTEND=noninteractive` on every install, not once at the top: this script is meant to be
# runnable as `curl … | sudo bash`, where **stdin is the script itself**. A debconf prompt there does
# not stall waiting for a human — it eats the rest of the script.
apt_install() {
  apt_update_once
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null
}

pkg_installed() {
  dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q '^install ok installed'
}

as_user() { runuser -u "$DEPLOY_USER" -- "$@"; }

# ---------------------------------------------------------------------------- 1. firewall

step "Firewall — accept tcp/80 and tcp/443"

# Oracle's Ubuntu image ships an INPUT chain that ends in
# `REJECT --reject-with icmp-host-prohibited`, and *appending* an ACCEPT below that line does
# nothing at all: the packet was already rejected. That is the single most common reason a fresh
# Oracle VM answers ssh and drops every request to Caddy, even with the Security List wide open.
# So: find the first REJECT/DROP in the chain and insert above it.
RULES_V4=/etc/iptables/rules.v4
# Set by `open_port` when it actually inserts or appends a rule. Only a run that changed something
# — or one where the saved file does not exist yet — should re-save: `netfilter-persistent save`
# snapshots whatever is in the live `iptables` tables *right now*, and by the second run of this
# script that includes Docker's own `nat`/`DOCKER`/`DOCKER-USER` chains. Saving those into
# `/etc/iptables/rules.v4` means `netfilter-persistent.service` — which runs at boot before `dockerd`
# starts — restores a stale copy of Docker's chains, and `dockerd` then layers its real ones on top.
RULES_CHANGED=0

open_port() {
  local port="$1" at
  # One array, used for both `-C` (does this rule exist?) and `-I` (add it). They have to be the
  # same argument list or the check can never match what the insert wrote.
  local -a rule=(-p tcp -m tcp --dport "$port" -j ACCEPT)

  if iptables -C INPUT "${rule[@]}" 2>/dev/null; then
    skip "tcp/$port is already accepted"
    return 0
  fi

  # No `exit` in the awk program: under `pipefail`, an awk that quits early while `iptables` still
  # has output queued can turn the pipeline's exit status into 141 (SIGPIPE) and abort the script
  # under `set -e`. `!found` keeps only the first match without stopping the read.
  at="$(iptables -L INPUT --line-numbers -n | awk '!found && ($2 == "REJECT" || $2 == "DROP") { print $1; found=1 }')"
  if [ -n "$at" ]; then
    iptables -I INPUT "$at" "${rule[@]}"
    did "tcp/$port accepted — inserted as INPUT rule $at, above the default REJECT"
  else
    iptables -A INPUT "${rule[@]}"
    did "tcp/$port accepted — appended (this chain has no REJECT/DROP to get above)"
  fi
  RULES_CHANGED=1
}

open_port 80
open_port 443

# Persistence. Without this the rules are gone at the next reboot and the site is unreachable in a
# way that looks like a DNS or a Caddy problem. But only when this run actually changed something —
# or `rules.v4` does not exist yet, e.g. the rules were added by hand before the first bootstrap run
# — see the comment on `RULES_CHANGED` above for why an unconditional save is unsafe on a re-run.
if [ "$RULES_CHANGED" -eq 1 ] || [ ! -s "$RULES_V4" ]; then
  # The two debconf answers are pre-seeded because the package asks "save current IPv4 rules?" on
  # install. Under `curl … | sudo bash` there is no terminal to ask on. `false` for both,
  # deliberately: the explicit `netfilter-persistent save` below runs after the rules are in place,
  # whereas the install-time question would fire mid-way through.
  if pkg_installed iptables-persistent; then
    skip "iptables-persistent is already installed"
  else
    echo 'iptables-persistent iptables-persistent/autosave_v4 boolean false' | debconf-set-selections
    echo 'iptables-persistent iptables-persistent/autosave_v6 boolean false' | debconf-set-selections
    apt_install iptables-persistent
    did "installed iptables-persistent"
  fi

  netfilter-persistent save >/dev/null
  did "saved the rules to $RULES_V4 (they survive a reboot)"
else
  skip "no firewall rule changed and $RULES_V4 already exists — not re-saving (that would also snapshot Docker's live chains)"
fi

# IPv6 is left alone on purpose: an Oracle subnet has no IPv6 unless you assign one, and writing an
# ip6tables ACCEPT for an address family the VM does not have would be a rule nobody can test.

# ---------------------------------------------------------------------------- 2. swap

step "Swap"

if [ -n "$(swapon --show)" ]; then
  skip "this machine already has swap — leaving it alone"
else
  if [ -e "$SWAP_FILE" ]; then
    die "$SWAP_FILE exists but no swap is active. Look at it by hand — 'swapon $SWAP_FILE' to use it, or remove it — then re-run."
  fi
  # `fallocate` is instant on ext4. A filesystem that cannot do it (some overlay and ZFS setups)
  # fails here, and `dd` is the slow, universal fallback.
  fallocate -l "${SWAP_MB}M" "$SWAP_FILE" 2>/dev/null ||
    dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$SWAP_MB" status=none
  chmod 600 "$SWAP_FILE"
  mkswap "$SWAP_FILE" >/dev/null
  swapon "$SWAP_FILE"
  did "created and enabled a ${SWAP_MB} MB swapfile at $SWAP_FILE"
fi

# /etc/fstab separately, and only for a swapfile that actually exists: the file can be present and
# in use without surviving a reboot, and writing an fstab line for a path that is not there is how
# you get a machine that fails to boot.
if [ -f "$SWAP_FILE" ]; then
  if grep -qs "^$SWAP_FILE " /etc/fstab; then
    skip "/etc/fstab already mounts $SWAP_FILE"
  else
    printf '%s none swap sw 0 0\n' "$SWAP_FILE" >> /etc/fstab
    did "added $SWAP_FILE to /etc/fstab"
  fi
fi

# ---------------------------------------------------------------------------- 3. Docker

step "Docker Engine + Compose v2 plugin"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  skip "already present: $(docker --version), Compose $(docker compose version --short)"
else
  # `arm64` on an A1.Flex, `amd64` on the x86 Always Free shapes. Asking dpkg is the only way to be
  # right on both without a uname-to-Debian-arch table of one's own.
  ARCH="$(dpkg --print-architecture)"
  CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME:-}")"
  [ -n "$CODENAME" ] || die "could not read VERSION_CODENAME from /etc/os-release"

  apt_install ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings

  if [ -s "$DOCKER_KEY" ]; then
    skip "Docker's apt signing key is already at $DOCKER_KEY"
  else
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o "$DOCKER_KEY"
    chmod a+r "$DOCKER_KEY"
    did "fetched Docker's apt signing key"
  fi

  WANT_LIST="deb [arch=$ARCH signed-by=$DOCKER_KEY] https://download.docker.com/linux/ubuntu $CODENAME stable"
  if [ "$(cat "$DOCKER_LIST" 2>/dev/null)" = "$WANT_LIST" ]; then
    skip "$DOCKER_LIST already points at $ARCH/$CODENAME"
  else
    printf '%s\n' "$WANT_LIST" > "$DOCKER_LIST"
    APT_UPDATED=0   # a new source list means the cached index no longer knows everything
    did "wrote $DOCKER_LIST ($ARCH, $CODENAME)"
  fi

  apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  did "installed $(docker --version), Compose $(docker compose version --short)"
fi

if systemctl is-enabled --quiet docker 2>/dev/null && systemctl is-active --quiet docker; then
  skip "the docker service is enabled and running"
else
  systemctl enable --now docker >/dev/null
  did "enabled and started the docker service"
fi

# ---------------------------------------------------------------------------- 4. docker group

step "Group membership"

DEPLOY_USER_GROUPS="$(id -nG "$DEPLOY_USER")"   # captured first, so the pipeline below never has a
                                                 # `grep -q` that can exit before `id` finishes writing
if printf '%s\n' "$DEPLOY_USER_GROUPS" | tr ' ' '\n' | grep -qx docker; then
  skip "$DEPLOY_USER is already in the docker group"
else
  usermod -aG docker "$DEPLOY_USER"
  did "added $DEPLOY_USER to the docker group — a group is read at LOGIN, so open a new ssh session before the first docker command"
fi

# ---------------------------------------------------------------------------- 5. auto updates

step "Automatic security updates"

if pkg_installed unattended-upgrades; then
  skip "unattended-upgrades is already installed"
else
  apt_install unattended-upgrades
  did "installed unattended-upgrades"
fi

# Ubuntu's stock /etc/apt/apt.conf.d/50unattended-upgrades already limits this to the `-security`
# pocket and leaves `Automatic-Reboot` off, so nothing here reboots the machine under a live table.
# The file below is only the on switch.
if grep -qs 'APT::Periodic::Unattended-Upgrade "1"' "$AUTO_UPGRADE_CONF"; then
  skip "$AUTO_UPGRADE_CONF already enables it"
else
  cat > "$AUTO_UPGRADE_CONF" <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
  did "wrote $AUTO_UPGRADE_CONF"
fi

# ---------------------------------------------------------------------------- 6. the repository

step "git"

if command -v git >/dev/null 2>&1; then
  skip "$(git --version)"
else
  apt_install git
  did "installed $(git --version)"
fi

step "Repository at $CHECKOUT_DIR"

# Every git command runs as $DEPLOY_USER, not as root. Two reasons, and the second one bites: the
# checkout must be writable by the account that runs `docker compose`, and git refuses to operate on
# a repository owned by somebody else ("detected dubious ownership") — which is exactly what root
# would find on the second run of this script.
#
# `chown user:` with the trailing colon and no group: that is the user's own login group, which is
# `ubuntu` here and whatever it is on a host where DEPLOY_USER was overridden.
if [ -d "$CHECKOUT_DIR/.git" ]; then
  chown -R "$DEPLOY_USER:" "$CHECKOUT_DIR"
  as_user git -C "$CHECKOUT_DIR" fetch --quiet origin "$BRANCH"
  as_user git -C "$CHECKOUT_DIR" checkout --quiet "$BRANCH"
  # `--ff-only`: bring the checkout forward or stop. A merge commit made by a bootstrap script on a
  # server, on a branch nobody is watching, is not something anyone wants to discover later.
  as_user git -C "$CHECKOUT_DIR" merge --ff-only --quiet "origin/$BRANCH"
  did "updated to $(as_user git -C "$CHECKOUT_DIR" rev-parse --short HEAD) on $BRANCH"
elif [ -e "$CHECKOUT_DIR" ] && [ -n "$(ls -A "$CHECKOUT_DIR" 2>/dev/null)" ]; then
  die "$CHECKOUT_DIR exists, is not empty, and is not a git checkout. Move it aside and re-run."
else
  mkdir -p "$CHECKOUT_DIR"
  chown "$DEPLOY_USER:" "$CHECKOUT_DIR"
  as_user git clone --quiet --branch "$BRANCH" "$REPO_URL" "$CHECKOUT_DIR"
  did "cloned $REPO_URL ($BRANCH) into $CHECKOUT_DIR"
fi

chown -R "$DEPLOY_USER:" "$CHECKOUT_DIR"
did "$CHECKOUT_DIR belongs to $DEPLOY_USER"

# ---------------------------------------------------------------------------- next steps

# An unquoted heredoc, so $DEPLOY_USER and $CHECKOUT_DIR come out filled in — which means the two
# `openssl` lines have to be escaped (\$), or this script would generate a pair of secrets, print
# them to the console and to the ssh log, and then throw them away.
cat <<BANNER

──────────────────────────────────────────────────────────────────────────────
Bootstrap finished. The machine is ready. Nothing is running yet.

Open a NEW ssh session as $DEPLOY_USER first — the docker group is only picked
up at login — and then:

  1. DNS. Point an A record at this machine's public IP and wait for it to
     propagate, or skip the DNS step entirely with sslip.io:
         play.<your-domain>            → <public IP>
         play.<ip-with-dashes>.sslip.io   needs no record at all

  2. Configuration. Compose does NOT run commands inside .env — generate the
     two secrets first, then paste the values in:
         openssl rand -hex 24        → POSTGRES_PASSWORD (hex: never has '/')
         openssl rand -base64 48     → SESSION_SECRET

         cd $CHECKOUT_DIR/deploy/normal
         cp .env.example .env && nano .env
         DOMAIN=…                        the name from step 1
         POSTGRES_PASSWORD=…             paste the hex value above
         SESSION_SECRET=…                paste the base64 value above
         chmod 600 .env

  3. Build and start. The FIRST build is an ARM build of an image that has never
     been built anywhere — allow 15–30 minutes and watch it:
         docker compose up -d --build
         docker compose logs -f migrate       # this one first, then app, then caddy

  4. Check. \$DOMAIN is only in .env, not your shell — load it first:
         set -a; . ./.env; set +a
         curl -fsS https://\$DOMAIN/health

  5. Backups: deploy/oracle/backup-cron.example.

The runbook, including what to do when step 3 fails:
    $CHECKOUT_DIR/deploy/oracle/README.md
──────────────────────────────────────────────────────────────────────────────
BANNER
