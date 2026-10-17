#!/usr/bin/env bash
# Redeploy Sideline (PLAN Task 7, D-066): move the deploy checkout to a commit, install the
# dependencies, build the web app, restart the service and check its health.
#
#   deploy/update.sh [ref]               a branch, tag or commit of this repository; default main,
#                                        the audited line (a tag such as t07-verified rolls back,
#                                        docs/ROLLBACK.md)
#   deploy/update.sh --dry-run [ref]     print the plan and change nothing
#   deploy/update.sh --no-restart [ref]  check out, install and build only (install.sh's first step)
#   deploy/update.sh --dir <path> [ref]  another deploy checkout (default /srv/sideline)
#
# Run it as the developer who owns this repository, never as root: a root build would leave
# root-owned files behind. The deploy checkout is a clone of this repository detached at the
# deployed commit, so branches, builds and tests here never change the public site until this
# script runs. The restart needs no password: it uses the one sudo rule install.sh adds. The health
# check retries for a minute and prints the service's last log lines if it fails.
set -Eeuo pipefail
trap 'printf "update: error: line %s failed (exit %s)\n" "$LINENO" "$?" >&2' ERR

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
DEPLOY_DIR=/srv/sideline
CADDYFILE=/etc/caddy/Caddyfile
DRY_RUN=0
RESTART=1
REF=main

say() { printf 'update: %s\n' "$*"; }
die() {
  printf 'update: error: %s\n' "$*" >&2
  exit 1
}
# Every change goes through run(): a dry run prints the command instead of running it.
run() {
  if ((DRY_RUN)); then
    printf 'update: would run: %s\n' "$*"
  else
    "$@"
  fi
}
usage() { sed -n '2,/^set -E/{/^set -E/d;s/^# \{0,1\}//;p}' "$0"; }

while (($# > 0)); do
  case $1 in
    --dry-run) DRY_RUN=1 ;;
    --no-restart) RESTART=0 ;;
    --dir)
      DEPLOY_DIR=${2:?--dir needs a path}
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*) die "unknown option $1 (see --help)" ;;
    *) REF=$1 ;;
  esac
  shift
done

((EUID != 0)) || die "run it as the developer who owns $REPO_DIR, not as root (a root build leaves root-owned files)"
# node and pnpm live in ~/.local/bin (AGENTS.md); appended, so an earlier PATH entry still wins.
export PATH="$PATH:$HOME/.local/bin"
command -v pnpm >/dev/null || die "pnpm is not on PATH (expected in ~/.local/bin)"

# The commit, resolved in this repository: it has every branch and tag the deploy checkout fetches.
sha=$(git -C "$REPO_DIR" rev-parse --verify --quiet "$REF^{commit}") || die "no commit for '$REF' in $REPO_DIR"
say "deploying $(git -C "$REPO_DIR" log -1 --format='%h %s' "$sha") ($REF) to $DEPLOY_DIR"

if [[ -d $DEPLOY_DIR/.git ]]; then
  origin=$(git -C "$DEPLOY_DIR" remote get-url origin 2>/dev/null || true)
  [[ $origin == "$REPO_DIR" ]] || die "$DEPLOY_DIR is not a deploy checkout of $REPO_DIR (origin: ${origin:-none})"
  # A deploy checkout is never edited by hand; refuse rather than throw someone's change away.
  [[ -z $(git -C "$DEPLOY_DIR" status --porcelain --untracked-files=no) ]] ||
    die "$DEPLOY_DIR has local changes (git -C $DEPLOY_DIR status): it is a deploy checkout, not a place to edit"
  run git -C "$DEPLOY_DIR" fetch --quiet --prune origin \
    '+refs/heads/*:refs/remotes/origin/*' '+refs/tags/*:refs/tags/*'
elif ((DRY_RUN)) || [[ -d $DEPLOY_DIR && -w $DEPLOY_DIR && -z $(ls -A "$DEPLOY_DIR") ]]; then
  run git clone --quiet "$REPO_DIR" "$DEPLOY_DIR"
else
  die "$DEPLOY_DIR is missing, not empty or not writable by $(id -un): run sudo deploy/install.sh first"
fi
run git -C "$DEPLOY_DIR" checkout --quiet --detach "$sha"
# The service may write only here (sideline.service: ReadWritePaths); the directory must exist.
run mkdir -p "$DEPLOY_DIR/data/runtime"
run pnpm --dir "$DEPLOY_DIR" install --frozen-lockfile
run pnpm --dir "$DEPLOY_DIR" build

if ((!RESTART)); then
  if ((DRY_RUN)); then
    say "dry run: nothing was changed"
  else
    say "built $(git -C "$REPO_DIR" rev-parse --short "$sha") in $DEPLOY_DIR; not restarted (--no-restart)"
  fi
  exit 0
fi

# The server keeps index.html in memory, so the restart is what makes the new build live.
run sudo -n systemctl restart sideline ||
  die "could not restart sideline without a password: run sudo deploy/install.sh first (it adds the sudo rule)"

# Prints the body of the first good answer from $1 within $2 tries, two seconds apart.
healthy() {
  local url=$1 tries=$2 i body
  for ((i = 1; i <= tries; i++)); do
    if body=$(curl -fsS -m 5 "$url" 2>/dev/null); then
      printf 'update: %s\n' "$body"
      return 0
    fi
    sleep 2
  done
  return 1
}
if ((DRY_RUN)); then
  say "would check the server's health on the port and site in $CADDYFILE"
  say "dry run: nothing was changed"
  exit 0
fi
# install.sh wrote both into the Caddyfile: the site, and the loopback port it proxies to.
port=$(sed -n 's/^[[:space:]]*reverse_proxy 127\.0\.0\.1:\([0-9][0-9]*\)[[:space:]]*$/\1/p' "$CADDYFILE" 2>/dev/null || true)
port=${port%%$'\n'*}
[[ -n $port ]] || die "no 'reverse_proxy 127.0.0.1:<port>' in $CADDYFILE: run sudo deploy/install.sh first"
say "health: http://127.0.0.1:$port/api/health"
if ! healthy "http://127.0.0.1:$port/api/health" 30; then
  journalctl -u sideline -n 30 --no-pager 2>/dev/null || true
  die "sideline did not answer on 127.0.0.1:$port (systemctl status sideline)"
fi
site=$(awk '!/^[[:space:]]*#/ && /\{[[:space:]]*$/ { print $1; exit }' "$CADDYFILE" 2>/dev/null || true)
if [[ -n $site ]]; then
  say "health: https://$site/api/health"
  healthy "https://$site/api/health" 15 || die "https://$site/ did not answer (journalctl -u caddy)"
fi
say "deployed $(git -C "$REPO_DIR" rev-parse --short "$sha") ($REF)${site:+ at https://$site/}"
