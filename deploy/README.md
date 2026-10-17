# Deploying Sideline (Milestone A)

One EC2 host serves the public link: Caddy terminates TLS for `<public-ip-with-dashes>.sslip.io`
(no domain to buy; sslip.io answers that name with the IP inside it) and proxies to the Node server,
which systemd keeps running. Decisions: D-025 (Caddy, sslip.io, systemd), D-066 (as built).

```
browser ──HTTPS :443──► Caddy (/etc/caddy/Caddyfile, Let's Encrypt certificate, HTTP → HTTPS on :80)
                          └──► 127.0.0.1:8787  Node 24: apps/server/src/index.ts  (sideline.service)
                                 runs in /srv/sideline: a clone of this repository at the deployed commit
                                 reads /etc/sideline/sideline.env (root-only): AI keys and settings
                                 writes /srv/sideline/data/runtime only (SQLite: AI cache, traces, analytics)
```

The deploy checkout (`/srv/sideline`) is separate from this working copy on purpose: `pnpm verify`
rebuilds `apps/web/dist`, tests share `data/runtime`, and branches come and go here, none of which
may change what the public link serves. Only `deploy/update.sh` moves the deploy checkout.

## Once, by hand (the parts a script cannot do)

1. **AWS security group** of the instance: inbound TCP **80** and **443** from `0.0.0.0/0` (and
   `::/0` for IPv6). Port 80 is needed too: Let's Encrypt checks the host over HTTP, and Caddy
   redirects every other HTTP request to HTTPS.
2. **Elastic IP** associated with the instance, so the public IP, and with it the sslip.io name,
   survives a stop and start. A new IP means a new name: re-run `install.sh`.
3. **Install**, from this repository (it asks for your password once):
   ```bash
   deploy/install.sh --dry-run        # the plan: every file and command, nothing changed
   sudo deploy/install.sh             # ends with "done: Sideline is live at https://…/"
   ```

`install.sh` is idempotent: run it again whenever `.env`, the Caddyfile template or the unit
template changes. Options: `--keyless` (no AI keys in production: recorded AI and labelled fallbacks
only, never a paid call), `--ref <ref>` (default `main`), `--site <host>` (default from the EC2
metadata service), `--env-file <path>` (default `.env`).

## What `install.sh` puts on the host

| Path | What | Owner, mode |
| --- | --- | --- |
| `/srv/sideline` | deploy checkout, built by `deploy/update.sh --no-restart` as you | you, 755 |
| `/usr/share/keyrings/caddy-stable-archive-keyring.gpg`, `/etc/apt/sources.list.d/caddy-stable.list` | Caddy's official apt repository (caddyserver.com/docs/install) | root, 644 |
| `/etc/caddy/Caddyfile` | `deploy/Caddyfile.template` with the site name filled in, checked with `caddy validate` first | root, 644 |
| `/etc/sideline/sideline.env` | from `.env` by `scripts/deploy-env.ts`: only the variables the server reads; `HOST=127.0.0.1`, `PORT=8787`, `NODE_ENV=production` forced; names printed, never values | root, 600 |
| `/etc/systemd/system/sideline.service` | `deploy/sideline.service` filled in, checked with `systemd-analyze verify` first; sandboxed (read-only system and home, writes only `data/runtime`) | root, 644 |
| `/etc/sudoers.d/sideline` | one rule: you may run `/usr/bin/systemctl restart sideline` without a password (for `update.sh`), checked with `visudo` first | root, 440 |

If ufw is filtering, it also allows 80/tcp and 443/tcp (on this host ufw is installed but disabled).

## Everyday

```bash
deploy/update.sh                   # redeploy main: fetch, check out, install, build, restart, health
deploy/update.sh t06-verified      # roll back to any tag, branch or commit (docs/ROLLBACK.md)
deploy/update.sh --dry-run         # the plan only
curl -fsS https://<host>/api/health
systemctl status sideline          # and: journalctl -u sideline -f, journalctl -u caddy -f
```

`update.sh` runs as you (never with sudo) and needs no password. The page is briefly broken between
the new build and the restart (the server keeps `index.html` in memory), a second or two.

**AI key rotation or new AI settings:** update the key where it lives (`~/.bashrc` for Codex,
`.env` for Sideline: D-033), then `sudo deploy/install.sh` to rewrite `/etc/sideline/sideline.env`
and restart. With a key whose account has no credit, every AI card is a labelled fallback ("Fallback:
AI unavailable") and the control plane's trace says why (`PermissionDeniedError (403)`); topping the
account up is enough, no redeploy. Recorded AI (`data/ai-replay/`, from `pnpm ai:record`) is served
to everyone once it is committed and deployed, with or without a key.

## When something is wrong

| Symptom | Look at | Usual fix |
| --- | --- | --- |
| `install.sh` stops at the HTTPS check | `journalctl -u caddy -n 50` | open 80 and 443 in the security group; Let's Encrypt allows 5 failed checks an hour |
| 502 from Caddy | `systemctl status sideline`, `journalctl -u sideline -n 50` | fix the error it shows; `sudo systemctl restart sideline` |
| blank page right after a build | the asset names in `index.html` | `sudo systemctl restart sideline` (`update.sh` does this) |
| `update.sh: could not restart sideline without a password` | `sudo -l` | `sudo deploy/install.sh` (it adds the rule) |
| `update.sh: … has local changes` | `git -C /srv/sideline status` | the deploy checkout is never edited: `git -C /srv/sideline checkout -- .` |

## Removing it

```bash
sudo systemctl disable --now sideline
sudo rm /etc/systemd/system/sideline.service /etc/sudoers.d/sideline && sudo rm -r /etc/sideline
sudo systemctl daemon-reload
sudo apt-get remove caddy && sudo rm /etc/apt/sources.list.d/caddy-stable.list /usr/share/keyrings/caddy-stable-archive-keyring.gpg
sudo rm -r /srv/sideline
```
