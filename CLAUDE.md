# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Centralized infrastructure for all society projects on this host: **Keycloak**
(OAuth2/OIDC — one shared realm per project, e.g. `standalone` for this repo's
own dashboard, `society-events` for `~/event-management`), a **Cloudflare
Tunnel** (public reachability for every registered subdomain), and — added in
this session — a **free, self-hosted SMS/OTP gateway** built on committee
members' Android phones reached over Tailscale. Sibling projects (like
`~/event-management`) register with this repo rather than running their own
Keycloak/tunnel/SMS infrastructure.

Run with `podman-compose` (not `docker-compose`) from the repo root.

## Commands

```bash
podman-compose ps                          # health status of all containers
podman-compose up -d <service>             # bring up one service (see Deploy gotchas below)
podman-compose build <service>             # rebuild an image after requirements.txt/Dockerfile changes
podman logs --tail 50 auth-service_<svc>_1 # e.g. backend, frontend, keycloak, tailscale, cloudflared, db
```

There is no test suite in this repo.

## Deploy gotchas (read before touching podman-compose.yml)

Podman groups every service in this compose file into **one pod**
(`pod_auth-service`), and `podman-compose` sets `--requires` dependency chains
from `depends_on`: `backend` requires `keycloak`+`db`; `frontend` requires
`backend`; `cloudflared` requires `frontend`+`backend`. Consequence: **you
cannot remove/recreate `db` or `keycloak` without cascading through
`backend`→`frontend`→`cloudflared`** — Podman refuses partial removal
otherwise. `tailscale` is independent (nothing requires it, so it never gets
pulled into a cascade started elsewhere).

Two different deploy paths depending on what changed:

- **Code-only change** (no new dependency, no `podman-compose.yml`/env
  change): hot-patch the running container instead of rebuilding —
  ```bash
  podman cp backend/app/main.py auth-service_backend_1:/app/app/main.py
  podman restart auth-service_backend_1
  ```
  This is the fast loop used throughout this session. `backend` needs the
  `restart` because uvicorn isn't running with `--reload`. `frontend` doesn't
  even need a restart — it's a Vite dev server with no source volume mount,
  but Vite compiles each file **on request** rather than serving a prebuilt
  bundle, so `podman cp`-ing a changed `.jsx`/`.js` file is picked up on the
  next page load. Vite's own HMR websocket won't reliably fire from a
  `podman cp` (vs. a real filesystem `write()` an editor would do), so tell
  whoever's testing to **hard-refresh the browser tab**, not wait for
  auto-reload.

- **`podman-compose.yml` changed** (new service, changed `command:`, new env
  var) or `requirements.txt` changed: rebuild the image, then remove
  containers in **dependency order** before recreating —
  ```bash
  podman-compose build backend      # only if requirements.txt changed
  podman rm -f auth-service_cloudflared_1
  podman rm -f auth-service_frontend_1
  podman rm -f auth-service_backend_1
  # ...and auth-service_keycloak_1 too, if the keycloak command/env changed
  podman-compose up -d
  ```
  In practice `podman-compose up -d` after any partial removal has, every
  time this session, ended up recreating the **whole pod** (including `db`
  and `tailscale` even though they weren't removed) — this is harmless, just
  surprising. **No data is lost either way**: Postgres data (`pgdata`),
  Keycloak data (`kcdata`), and Tailscale's node identity (`tailscale-state`)
  all live in named volumes, completely decoupled from container lifecycle.
  Tailscale in particular reconnects using its existing identity after a
  recreate — it does **not** need `TS_AUTHKEY` again unless the
  `tailscale-state` volume itself is wiped.

## SMS Gateway / OTP system

**Why it exists**: avoid paying for Twilio/etc. Instead, committee members'
own Android phones run the open-source [SMS Gateway for
Android](https://github.com/capcom6/android-sms-gateway) app (install the
**release** APK, not `-insecure`, from its GitHub Releases — it's not on the
Play Store) in **local-server mode**, reached over a private
[Tailscale](https://tailscale.com) network instead of exposing anything to
the public internet.

### Networking: why a Tailscale *sidecar*, not `network_mode: service:tailscale`

The `tailscale` service in `podman-compose.yml` runs in **userspace
networking mode** (`TS_USERSPACE=true`) and exposes a **SOCKS5 proxy on port
1055**. Two things this avoids:

- Kernel networking mode (`TS_USERSPACE=false`) needs real `NET_ADMIN`/TUN
  access, which rootless Podman won't grant — it fails with `iptables ...
  Permission denied (you must be root)`. Userspace mode sidesteps this
  entirely since it never touches the host network stack.
- Making `backend` join Tailscale's network namespace directly
  (`network_mode: "service:tailscale"`) would have made `backend` lose its
  own `backend` DNS alias inside the compose network — which `frontend` and
  `cloudflared` depend on. The SOCKS5-proxy-sidecar approach avoids touching
  how any other container already resolves `backend`.

`backend`'s own outbound HTTP client reaches phones through this proxy
(`socks5://tailscale:1055` — note: **`socks5://` not `socks5h://`**, since
httpx 0.27's `Proxy` class only recognizes the former; targets are Tailscale
IPs anyway, so no DNS-through-proxy is needed).

### Data model & code

- **`sms_gateways`** table (Postgres, `backend/app/models.py`) — the
  configurable, priority-ordered fallback list of committee phones: label,
  Tailscale host/IP, port, Basic-Auth username/password (from the phone
  app's Settings tab), priority (lower = tried first), enabled, last known
  status. Managed via `/api/sms-gateways` CRUD + the dashboard's **"OTP & SMS
  Monitor"** page (`frontend/src/pages/Monitor.jsx`).
- **`backend/app/sms_gateway.py`** — `send_otp(db, phone, text)` tries every
  enabled gateway in priority order over the SOCKS5 proxy, logs every
  attempt, returns on first success. This is the core failover logic.
- **`POST /api/sms/send`** — machine-to-machine endpoint for *other*
  projects that just need "send this text to this phone" (auth: `X-API-Key`
  header = `OTP_SERVICE_API_KEY` from `.env`). This is what
  `~/event-management`'s `SMS_GATEWAY=auth_service` option calls — see that
  repo's `services/otp/app/sms.py`.
- **`POST /api/otp/request` / `POST /api/otp/verify` / `GET
  /api/otp/history`** — auth-service's **own** turnkey OTP
  generation/verification/history (`otp_requests`/`otp_send_log` tables,
  `backend/app/otp_service.py`), for future projects that don't want to
  build their own OTP state machine. **`event-management` does not use
  this** — it has its own pre-existing Redis-based OTP system
  (`services/otp`) and only calls `/api/sms/send` above for transport. So
  this table is mostly test data, not real traffic.
- **`GET /api/event-otp/transactions`** — proxies
  `event-management`'s own otp-service `/transactions` rollup endpoint
  (cross-project, over `host.containers.internal:8080`) so the dashboard's
  **"OTP Transactions"** page (`frontend/src/pages/OtpTransactions.jsx`) can
  show *real* production login activity. Auth: normal dashboard JWT on this
  side; `X-Auth-Service-Key` header (same `OTP_SERVICE_API_KEY` value) on
  the far side. The actual OTP code is **never** shown or recoverable on
  either side — both systems only ever store a one-way hash of it.

### Hard dependency on event-management: Keycloak needs `--features=token-exchange`

`event-management`'s OTP login bridge (`otp-bridge` service account) uses
Keycloak's RFC 8693 Token Exchange grant to mint a real access token for an
OTP-verified user. This requires the `keycloak` service's `command:` in
`podman-compose.yml` to include `--features=token-exchange` — **it's easy for
this to silently regress** (e.g. a fresh realm import without checking the
compose command line). If missing, Keycloak's token endpoint returns
`{"error":"unsupported_grant_type"}`, which surfaces on the
`event-management` side as `RuntimeError: Identity provider token exchange
failed` in `society_otp_service` logs. Verify with:
```bash
podman inspect auth-service_keycloak_1 --format '{{.Config.Cmd}}'
# expect: [start-dev --import-realm --features=token-exchange]
```
Fixing it requires recreating the `keycloak` container (see Deploy gotchas —
this cascades through `backend`/`frontend`/`cloudflared` too).

### Troubleshooting: "Proxy Server could not connect: General SOCKS server failure"

**Symptom**: an OTP transaction shows `sms_delivery_failed: true`, or
`society_otp_service` logs show `[SMS-AUTHSVC] Failed ...: Proxy Server could
not connect: General SOCKS server failure.`

**Usual cause**: the `tailscale` container was just recreated (any full
`podman-compose up -d` after removing containers recreates the whole pod,
including `tailscale` — see Deploy gotchas) and its WireGuard connection to
the phone hadn't fully re-established yet. This takes a few seconds, not
minutes.

**How to verify**:
```bash
# 1. Is the phone actually online in the tailnet? "idle" is fine, "offline" is not.
podman exec auth-service_tailscale_1 tailscale status

# 2. curl isn't persisted in the tailscale image across recreates — reinstall if needed:
podman exec auth-service_tailscale_1 apk add --no-cache curl

# 3. Direct test through the same path the backend uses (get host/port/creds
#    from the sms_gateways table / dashboard):
podman exec auth-service_tailscale_1 curl -s -m 8 \
  --socks5-hostname 127.0.0.1:1055 -u <gw_username>:<gw_password> \
  http://<phone-tailscale-ip>:<port>/health
# expect a 200 JSON payload with "status":"pass"
```

**Fix**: usually nothing to do but wait ~30s and retry — it self-resolves
once Tailscale's peer connection re-establishes. If the phone genuinely shows
`offline` for more than a couple minutes, check the phone itself (is the
SMSGate app's "Local server" toggle still on? Is Tailscale still running? See
"Adding a new gateway phone" below for the battery-optimization settings that
prevent this).

**Known limitation**: redeploying `auth-service` while a real OTP request is
in flight will drop that specific send. Fine for current dev/debugging
volume; would need a graceful-drain strategy before this serves real users
at scale.

### Adding a new committee gateway phone

1. Download the **release** APK (not `-insecure`) from
   [capcom6/android-sms-gateway releases](https://github.com/capcom6/android-sms-gateway/releases)
   and sideload it (Settings → Install unknown apps).
2. Android 13+ blocks the SMS permission on sideloaded apps by default
   ("Restricted settings") — go to the app's info page → ⋮ menu → **"Allow
   restricted settings"**, then grant SMS permission normally.
3. Turn **off** "Manage app if unused" in the app's permission settings —
   otherwise Android's auto-revoke can silently strip SMS permission after
   months of inactivity.
4. Install Tailscale on the phone and join the same tailnet as this repo's
   `tailscale` sidecar.
5. In the SMSGate app: enable **Local server**, note the port (Settings tab
   also shows a generated username/password for Basic Auth).
6. Get the phone's Tailscale IP: `podman exec auth-service_tailscale_1
   tailscale status`.
7. Register it: dashboard → **OTP & SMS Monitor** → "Add gateway phone" (or
   `POST /api/sms-gateways`), then use its **Ping** button to confirm
   reachability before relying on it.

## Ports

| Component | Port |
|---|---|
| Frontend (Vite dev) | 5174 |
| Backend (FastAPI) | 8000 |
| Keycloak | 8180 (admin console at `/admin`), management/health on 9000 (internal only) |
| PostgreSQL | 5433 |
| Tailscale SOCKS5 proxy | 1055 (internal to the pod only, not published) |

Credentials and API keys (Keycloak admin, `OTP_SERVICE_API_KEY`,
`TS_AUTHKEY`, Cloudflare token, etc.) live in `.env` — this file is not
committed with real values in mind, so don't copy secrets from here into
git-tracked docs.
