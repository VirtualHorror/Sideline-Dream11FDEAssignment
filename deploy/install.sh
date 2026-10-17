#!/usr/bin/env bash
# Sideline's production install (PLAN Task 7, D-025, D-066): the app at
# https://<public-ip-with-dashes>.sslip.io/, behind Caddy, kept alive by systemd.
#
#   sudo deploy/install.sh              install, or bring an install up to date (idempotent)
#   deploy/install.sh --dry-run         print the plan and change nothing (no sudo needed)
#   sudo deploy/install.sh --keyless    the same with the AI keys left out: recorded AI and
#                                       labelled fallbacks only, never a paid call
#   Options: --ref <ref>        the branch, tag or commit to deploy (default main, the audited line)
#            --site <host>      the sslip.io name (default: from the EC2 metadata service, IMDSv2)
#            --domain <host>    the owner's domain, served too (default sideline.nabhanyubm.tech;
#                               --domain '' serves the sslip.io name only)
#            --env-file <path>  where the AI settings come from (default: this repository's .env)
#            --dir <path>       the deploy checkout (default /srv/sideline; the tests use their own)
#
# In order: the deploy checkout /srv/sideline (a clone of this repository at the ref, built by
# deploy/update.sh as the developer, so work in this checkout never touches the public site);
# Caddy from its official apt repository; /etc/caddy/Caddyfile for the site;
# /etc/sideline/sideline.env (root-only, from .env: names are printed, values never); the sideline
# systemd unit; one sudo rule that lets the developer restart it (deploy/update.sh); 80 and 443 in
# ufw if ufw is filtering; then both services and a health check, locally and over HTTPS.
# The AWS console steps (security group, Elastic IP) are in deploy/README.md.
set -Eeuo pipefail
trap 'printf "install: error: line %s failed (exit %s)\n" "$LINENO" "$?" >&2' ERR

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
DEPLOY_DIR=/srv/sideline
ENV_DIR=/etc/sideline
ENV_FILE=$ENV_DIR/sideline.env
UNIT_FILE=/etc/systemd/system/sideline.service
CADDYFILE=/etc/caddy/Caddyfile
SUDOERS_FILE=/etc/sudoers.d/sideline
CADDY_REPO=https://dl.cloudsmith.io/public/caddy/stable
CADDY_KEYRING=/usr/share/keyrings/caddy-stable-archive-keyring.gpg
CADDY_SOURCES=/etc/apt/sources.list.d/caddy-stable.list
# The owner's domain: a DNS A record to this host's Elastic IP (D-068). Caddy serves it next to the
# sslip.io name and gets its certificate once the name resolves here.
DOMAIN=sideline.nabhanyubm.tech
# The server's loopback port. Not 8787: `pnpm dev` and its Vite proxy use that on this same host.
# install.sh is its one source: the Caddyfile, the unit and the environment file get it from here.
PORT=8780

ARGS=("$@")
DRY_RUN=0
KEYLESS=0
REF=main
SITE=""
SOURCE_ENV=$REPO_DIR/.env

say() { printf 'install: %s\n' "$*"; }
die() {
  printf 'install: error: %s\n' "$*" >&2
  exit 1
}
# Every change goes through run(): a dry run prints the command instead of running it.
run() {
  if ((DRY_RUN)); then
    printf 'install: would run: %s\n' "$*"
  else
    "$@"
  fi
}
usage() { sed -n '2,/^set -E/{/^set -E/d;s/^# \{0,1\}//;p}' "$0"; }

while (($# > 0)); do
  case $1 in
    --dry-run) DRY_RUN=1 ;;
    --keyless) KEYLESS=1 ;;
    --ref | --site | --domain | --env-file | --dir)
      [[ $# -ge 2 ]] || die "$1 needs a value"
      case $1 in
        --ref) REF=$2 ;;
        --site) SITE=$2 ;;
        --domain) DOMAIN=$2 ;;
        --env-file) SOURCE_ENV=$2 ;;
        --dir) DEPLOY_DIR=$2 ;;
      esac
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
  shift
done

# The app runs as the developer who owns this repository, with their Node 24 (AGENTS.md).
APP_USER=$(stat -c %U "$REPO_DIR")
[[ $APP_USER != root ]] || die "$REPO_DIR belongs to root: the app runs as the developer who owns it"
APP_GROUP=$(id -gn "$APP_USER")
APP_HOME=$(getent passwd "$APP_USER" | cut -d: -f6)
NODE_BIN=$APP_HOME/.local/bin/node
APP_PATH=$APP_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
if ((DRY_RUN)); then
  ((EUID == 0)) || [[ $(id -un) == "$APP_USER" ]] || die "run the dry run as root or as $APP_USER"
else
  ((EUID == 0)) || die "run it with sudo: sudo $0 ${ARGS[*]}  (or --dry-run first to see the plan)"
fi

# Runs a command as the developer: directly in their own dry run, through runuser when root runs.
as_app() {
  if ((EUID == 0)); then
    runuser -u "$APP_USER" -- env HOME="$APP_HOME" PATH="$APP_PATH" "$@"
  else
    "$@"
  fi
}

[[ -x $NODE_BIN ]] || die "no Node at $NODE_BIN (AGENTS.md: Node 24 in ~/.local/bin)"
NODE_VERSION=$(as_app "$NODE_BIN" --version)
[[ $NODE_VERSION == v24.* ]] || die "Node 24 is required; $NODE_BIN is $NODE_VERSION"
# These go into the unit file and sed expressions.
for value in "$APP_USER" "$APP_GROUP" "$APP_HOME" "$DEPLOY_DIR"; do
  [[ $value =~ ^[A-Za-z0-9._/-]+$ ]] || die "unexpected characters in '$value'"
done
# Absolute: root does not trust PATH, and the sudo rule must name what `sudo systemctl` runs.
SYSTEMCTL=/usr/bin/systemctl
[[ -x $SYSTEMCTL ]] || die "no $SYSTEMCTL: this needs a systemd host"

# The public IPv4 from the instance metadata service (IMDSv2: a session token first).
public_ipv4() {
  local token
  token=$(curl -fsS -m 3 -X PUT http://169.254.169.254/latest/api/token \
    -H 'X-aws-ec2-metadata-token-ttl-seconds: 60') &&
    curl -fsS -m 3 -H "X-aws-ec2-metadata-token: $token" \
      http://169.254.169.254/latest/meta-data/public-ipv4
}
ip=""
if [[ -z $SITE ]]; then
  ip=$(public_ipv4) || die "the EC2 metadata service has no public IPv4 for this host: attach an Elastic IP, or pass --site <host>"
  [[ $ip =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || die "the metadata service returned '$ip', not an IPv4 address"
  SITE=${ip//./-}.sslip.io
fi
for name in "$SITE" "$DOMAIN"; do
  [[ -z $name || $name =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || die "not a host name: $name"
done
# Caddy's site addresses: the sslip.io name, which always works, first.
SITES=$SITE${DOMAIN:+, $DOMAIN}

# Installs $3 as $1 (mode $2, owned by root) unless it is already identical, through a temporary
# file next to it that the optional validator ($4) checks first. Never call it in an || or &&
# list: bash would stop honouring set -e inside it.
put_file() {
  local path=$1 mode=$2 content=$3 validate=${4:-} tmp
  if [[ -r $path && $(cat -- "$path") == "$content" ]]; then
    say "  unchanged $path"
    return 0
  fi
  if ((DRY_RUN)); then
    say "  would write $path (mode $mode)"
    return 0
  fi
  tmp=$(mktemp "$path.XXXXXX")
  printf '%s\n' "$content" >"$tmp"
  chown root:root "$tmp"
  chmod "$mode" "$tmp"
  if [[ -n $validate ]] && ! "$validate" "$tmp"; then
    rm -f -- "$tmp"
    die "$path: the new file did not validate (above); the old one is untouched"
  fi
  mv -f -- "$tmp" "$path"
  say "  wrote $path (mode $mode)"
}
validate_caddyfile() {
  local out
  out=$(runuser -u caddy -- caddy validate --config "$1" --adapter caddyfile 2>&1) || {
    printf '%s\n' "$out" | tail -n 5 >&2
    return 1
  }
}
# systemd-analyze names the unit after its file, so the candidate is checked under its real name.
validate_unit() {
  local dir status=0
  dir=$(mktemp -d) || return 1
  cp -- "$1" "$dir/sideline.service" || status=1
  ((status)) || systemd-analyze verify "$dir/sideline.service" || status=1
  rm -rf -- "$dir"
  return "$status"
}
validate_sudoers() { visudo -cqf "$1"; }
# Prints the body of the first good answer from $1 within $2 tries, two seconds apart.
healthy() {
  local url=$1 tries=$2 i body
  for ((i = 1; i <= tries; i++)); do
    if body=$(curl -fsS -m 5 "$url" 2>/dev/null); then
      say "  $body"
      return 0
    fi
    sleep 2
  done
  return 1
}

((DRY_RUN)) && say "dry run: printing the plan, changing nothing"
say "site https://$SITE/${DOMAIN:+ and https://$DOMAIN/}  ref $REF  user $APP_USER  node $NODE_VERSION$( ((KEYLESS)) && printf '  keyless')"
say "repository $REPO_DIR, deploy checkout $DEPLOY_DIR"

say "1/7 deploy checkout: $DEPLOY_DIR at $REF (deploy/update.sh --no-restart, as $APP_USER)"
[[ -d $DEPLOY_DIR ]] || run install -d -o "$APP_USER" -g "$APP_GROUP" -m 755 "$DEPLOY_DIR"
update_args=(--no-restart --dir "$DEPLOY_DIR" "$REF")
((DRY_RUN)) && update_args=(--dry-run "${update_args[@]}")
as_app "$SCRIPT_DIR/update.sh" "${update_args[@]}"

say "2/7 Caddy from its official apt repository ($CADDY_REPO)"
if [[ ! -f $CADDY_SOURCES ]]; then
  # caddyserver.com/docs/install, "Debian, Ubuntu, Raspbian": the signing key, then the source.
  if ((DRY_RUN)); then
    say "  would fetch $CADDY_REPO/gpg.key into $CADDY_KEYRING"
    say "  would fetch $CADDY_REPO/debian.deb.txt into $CADDY_SOURCES, then apt-get update"
  else
    tmp=$(mktemp -d)
    curl -fsSL --proto '=https' --tlsv1.2 -o "$tmp/gpg.key" "$CADDY_REPO/gpg.key"
    gpg --homedir "$tmp" --batch --yes --dearmor -o "$CADDY_KEYRING" "$tmp/gpg.key"
    chmod 644 "$CADDY_KEYRING"
    # awk reads to the end: a reader that quits early can kill gpg with SIGPIPE under pipefail.
    fingerprint=$(gpg --homedir "$tmp" --batch --show-keys --with-colons "$CADDY_KEYRING" |
      awk -F: '$1 == "fpr" && !done { print $10; done = 1 }')
    say "  signing key $fingerprint in $CADDY_KEYRING"
    curl -fsSL --proto '=https' --tlsv1.2 -o "$tmp/caddy.list" "$CADDY_REPO/debian.deb.txt"
    install -m 644 -o root -g root "$tmp/caddy.list" "$CADDY_SOURCES"
    rm -rf -- "$tmp"
    say "  $(grep -m1 '^deb ' "$CADDY_SOURCES")"
    apt-get update -qq
  fi
fi
if [[ $(dpkg-query -W -f='${Status}' caddy 2>/dev/null || true) == "install ok installed" ]]; then
  say "  caddy is installed: $(dpkg-query -W -f='${Version}' caddy)"
else
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy
fi

say "3/7 $CADDYFILE for $SITES"
# Only a site name from the metadata service tells us this host's IP to compare the domain with.
if [[ -n $DOMAIN && -n $ip ]]; then
  resolved=$(getent ahostsv4 "$DOMAIN" | awk '{ print $1 }' | sort -u | tr '\n' ' ' || true)
  if [[ " $resolved" == *" $ip "* ]]; then
    say "  $DOMAIN resolves to $ip"
  else
    say "  warning: $DOMAIN resolves to '${resolved% }', not $ip: Caddy keeps asking for its certificate until the DNS A record points here"
  fi
fi
caddyfile=$(sed -e "s/@SITES@/$SITES/g" -e "s/@PORT@/$PORT/g" "$SCRIPT_DIR/Caddyfile.template")
((DRY_RUN)) && printf '%s\n' "$caddyfile" | grep -v '^#' | sed 's/^/install:     /'
put_file "$CADDYFILE" 644 "$caddyfile" validate_caddyfile

say "4/7 $ENV_FILE from $SOURCE_ENV (root-only; variable names below, never values)"
env_args=(--env-file "$SOURCE_ENV" --port "$PORT")
((KEYLESS)) && env_args+=(--keyless)
env_text=$(as_app "$NODE_BIN" "$REPO_DIR/scripts/deploy-env.ts" "${env_args[@]}") ||
  die "the environment file could not be built (above); nothing was installed from this step on"
[[ -d $ENV_DIR ]] || run install -d -m 700 -o root -g root "$ENV_DIR"
put_file "$ENV_FILE" 600 "$env_text"

say "5/7 $UNIT_FILE (runs $NODE_BIN apps/server/src/index.ts in $DEPLOY_DIR as $APP_USER)"
unit=$(sed -e "s|@APP_USER@|$APP_USER|g" -e "s|@APP_GROUP@|$APP_GROUP|g" \
  -e "s|@APP_HOME@|$APP_HOME|g" -e "s|@DEPLOY_DIR@|$DEPLOY_DIR|g" -e "s|@NODE_BIN@|$NODE_BIN|g" \
  -e "s|@ENV_FILE@|$ENV_FILE|g" -e "s|@PORT@|$PORT|g" "$SCRIPT_DIR/sideline.service")
[[ $unit != *@[A-Z_]*@* ]] || die "a placeholder in deploy/sideline.service was not filled in"
((DRY_RUN)) && printf '%s\n' "$unit" | grep -v '^#' | sed 's/^/install:     /'
put_file "$UNIT_FILE" 644 "$unit" validate_unit

say "6/7 $SUDOERS_FILE: $APP_USER may run '$SYSTEMCTL restart sideline' without a password (update.sh)"
sudoers="# Lets deploy/update.sh restart Sideline without a password (written by deploy/install.sh).
$APP_USER ALL=(root) NOPASSWD: $SYSTEMCTL restart sideline, $SYSTEMCTL restart sideline.service"
put_file "$SUDOERS_FILE" 440 "$sudoers" validate_sudoers

say "7/7 firewall, services and health"
if ((EUID != 0)); then
  say "  would open 80/tcp and 443/tcp in ufw if ufw is filtering (checking needs root)"
elif command -v ufw >/dev/null && [[ $(ufw status) == *"Status: active"* ]]; then
  run ufw allow 80/tcp
  run ufw allow 443/tcp
else
  say "  ufw is not filtering: nothing to open on this host (the security group opens 80 and 443)"
fi
run "$SYSTEMCTL" daemon-reload
run "$SYSTEMCTL" enable --quiet sideline caddy
# Restarted every time: a new environment file or build only takes effect on a restart.
if ! run "$SYSTEMCTL" restart sideline; then
  journalctl -u sideline -n 40 --no-pager || true
  die "sideline did not start (log above; systemctl status sideline)"
fi
run "$SYSTEMCTL" reload-or-restart caddy
if ((DRY_RUN)); then
  say "  would check http://127.0.0.1:$PORT/api/health, then https://$SITE/api/health"
  say "dry run: nothing was changed"
  exit 0
fi
say "  http://127.0.0.1:$PORT/api/health"
if ! healthy "http://127.0.0.1:$PORT/api/health" 30; then
  journalctl -u sideline -n 40 --no-pager || true
  die "the server did not answer on 127.0.0.1:$PORT (log above; systemctl status sideline)"
fi
say "  https://$SITE/api/health (the first start gets a certificate: allow a minute)"
if ! healthy "https://$SITE/api/health" 60; then
  journalctl -u caddy -n 40 --no-pager || true
  die "https://$SITE/ did not answer: are 80 and 443 open to the internet in the security group? (log above)"
fi
live="https://$SITE/"
if [[ -n $DOMAIN ]]; then
  say "  https://$DOMAIN/api/health"
  if healthy "https://$DOMAIN/api/health" 15; then
    live="https://$DOMAIN/ (and $live)"
  else
    say "  warning: https://$DOMAIN/ does not answer yet (its DNS, or its first certificate): Caddy keeps trying; re-run this script once the domain resolves to this host"
  fi
fi
say "done: Sideline is live at $live"
say "redeploy after a merge: deploy/update.sh   (as $APP_USER, no password)"
say "logs: journalctl -u sideline -f    journalctl -u caddy -f"
