# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Centralized infrastructure for all society projects on this host: **Keycloak**
(OAuth2/OIDC — one shared realm per project, e.g. `standalone` for this repo's
own dashboard, `society-events` for `~/event-management`), a **Cloudflare
Tunnel** (public reachability for every registered subdomain), and a **free
SMS/OTP gateway** built on committee members' Android phones running the
open-source [SMS Gateway for Android](https://github.com/capcom6/android-sms-gateway)
app in **Cloud Server** mode, sending through the app developer's free hosted
relay (`api.sms-gate.app`). Sibling projects (like `~/event-management`)
register with this repo rather than running their own Keycloak/tunnel/SMS
infrastructure.

**Note**: only `society-events` is sourced from the checked-in
`keycloak/realm.json` (imported via `--import-realm` on first boot). The
`standalone` realm (this repo's own dashboard) exists live in Keycloak but
has **no corresponding file in this repo** — it was created out-of-band (UI
or Admin API), so changes to it (e.g. authentication flow/required-action
config) only exist in the `kcdata` volume, not in git. A fresh clone +
`podman-compose up` would **not** recreate `standalone` as currently
configured. There's also an unrelated `ollama-chat` realm live in the same
Keycloak instance, outside this repo's scope entirely.

Run with `podman-compose` (not `docker-compose`) from the repo root.

## Commands

```bash
podman-compose ps                          # health status of all containers
podman-compose up -d <service>             # bring up one service (see Deploy gotchas below)
podman-compose build <service>             # rebuild an image after requirements.txt/Dockerfile changes
podman logs --tail 50 auth-service_<svc>_1 # e.g. backend, frontend, keycloak, cloudflared, db
```

There is no test suite in this repo.

## Deploy gotchas (read before touching podman-compose.yml)

Podman groups every service in this compose file into **one pod**
(`pod_auth-service`), and `podman-compose` sets `--requires` dependency chains
from `depends_on`: `backend` requires `keycloak`+`db`; `frontend` requires
`backend`; `cloudflared` requires `frontend`+`backend`. Consequence: **you
cannot remove/recreate `db` or `keycloak` without cascading through
`backend`→`frontend`→`cloudflared`** — Podman refuses partial removal
otherwise.

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
  even though it wasn't removed) — this is harmless, just surprising. **No
  data is lost either way**: Postgres data (`pgdata`) and Keycloak data
  (`kcdata`) both live in named volumes, completely decoupled from container
  lifecycle.

## SMS Gateway / OTP system

**Why it exists**: avoid paying for Twilio/etc. Instead, committee members'
own Android phones run the open-source [SMS Gateway for
Android](https://github.com/capcom6/android-sms-gateway) app with **Cloud
Server** mode toggled on. The phone dials *out* to the app developer's free
hosted relay (`api.sms-gate.app`) and self-registers, auto-generating a
username/password shown in the app's Cloud Server settings — no inbound
server on the phone and no private networking needed, so this backend also
just calls `https://api.sms-gate.app` directly over the public internet with
those same credentials via HTTP Basic Auth.

(Two earlier iterations of this gateway were tried and retired: first
capcom6/android-sms-gateway in **local-server** mode reached over a private
Tailscale network, then [httpSMS](https://httpsms.com)'s cloud API. Neither
remains in this repo — no Tailscale sidecar, SOCKS5 proxy, or httpSMS
`x-api-key` code is left.)

### Data model & code

- **`sms_gateways`** table (Postgres, `backend/app/models.py`) — the
  configurable, priority-ordered fallback list of committee phones: label,
  the app's auto-generated Cloud Server `username`/`password`, `device_id`
  (explicitly targets this phone in the send payload — Cloud Server accounts
  can have multiple devices, and omitting it lets `api.sms-gate.app`
  randomly pick any connected device on the account), priority (lower =
  tried first), enabled, last known status. Managed via `/api/sms-gateways`
  CRUD + the dashboard's **"OTP & SMS Monitor"** page
  (`frontend/src/pages/Monitor.jsx`).
- **`backend/app/sms_gateway.py`** — `send_otp(db, phone, text)` tries every
  enabled gateway in priority order, `POST`ing to
  `https://api.sms-gate.app/3rdparty/v1/message` with HTTP Basic Auth
  (`gw.username`/`gw.password`) and body `{"textMessage": {"text": ...},
  "phoneNumbers": [...], "deviceId": ...}`. This is the core failover logic
  — **confirmed working via a real curl call** (`POST /api/sms/send`
  returned `{"sent":true,"via":"<label>"}` and the cloud relay did route it
  to the registered device). The `ping()` function is a stub that always
  tells the caller to use `/api/sms-gateways/test-send` instead of claiming
  a real status — capcom6's Cloud Server mode has no synchronous per-device
  status endpoint (only a webhook, `system:ping`, which would need this
  backend to expose a public callback URL — not implemented). **Note**:
  `/api/sms-gateways/test-send` itself has no dashboard UI wired to it yet —
  `testSendSms()` exists in `frontend/src/lib/api.js` but nothing in
  `Monitor.jsx` calls it. Trigger it via `curl` (JWT or reuse
  `/api/sms/send` with the service key) until that gap is closed.

### Known limitation: Indian carriers block OTP-pattern SMS from personal SIMs

Confirmed by direct testing: a message like `"Your verification code is
123456. It expires in 5 minutes."` fails with Android's
`RESULT_ERROR_GENERIC_FAILURE`, sent **manually** from the phone's own native
Messages app — no gateway app or this backend involved. A generic-content
message (`"hi"`) sends fine from the same SIM. This means it's **carrier-side
anti-phishing content filtering** (both test SIMs were Jio), not a bug
anywhere in this repo, not a SIM-selection issue, and not specific to any
gateway app — it happens at the network level before the message leaves the
device, so a custom-built gateway app would hit the exact same wall.

This is a fundamental constraint on the entire "free SMS via personal SIM"
approach for real OTP content in India: TRAI regulations require
transactional/OTP SMS to go through a DLT-registered sender with an approved
template via a proper A2P aggregator — a personal SIM's P2P route gets
filtered specifically because "OTP-shaped" text sent from a random consumer
number is a common phishing pattern. **Don't try to reword OTP messages to
dodge this filter** — it's evading an anti-fraud control, it's fragile
(filters adapt), and repeated triggering risks the SIM itself getting
rate-limited/suspended by the carrier, which would break gateway delivery
entirely, not just OTP content.

Real fixes, if this needs to be reliable: (a) a proper DLT-registered SMS
provider (paid — the cost this whole approach was trying to avoid), or (b) a
non-SMS channel for verification content specifically — WhatsApp Business
API, email OTP, or (for repeat-login 2FA only, **not** one-time phone-number
verification — TOTP has no phone number in its protocol at all) an
authenticator app. See "Keycloak TOTP 2FA" below for the one piece of this
that's actually been implemented.
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
4. In the app, toggle on **Cloud Server** mode (not Local Server) and tap to
   connect — no account/signup needed. Once it shows "Online", the app's
   Cloud Server settings section displays an auto-generated username and
   password.
5. Register it: dashboard → **OTP & SMS Monitor** → "Add gateway phone" (or
   `POST /api/sms-gateways`) with the phone's `label`, `username`/`password`,
   and `device_id` (all shown in the app's Cloud Server settings section) —
   then trigger a real send via `curl` (see Data model & code above — there's
   no dashboard button for this yet) to confirm delivery before relying on
   it. The **Ping** button can't confirm real reachability for this
   transport.

## Keycloak TOTP 2FA (standalone realm)

`CONFIGURE_TOTP` is set as a **default required action** on the `standalone`
realm (live Keycloak config only — see the note under "What this repo is",
this isn't in `keycloak/realm.json`). Any new user in this realm must enroll
an authenticator app on first login; the existing `admin` user has
`CONFIGURE_TOTP` queued as a required action too, so they'll be prompted on
next login. After enrollment, Keycloak's default `browser` flow (`Browser -
Conditional OTP` → `Condition - user configured` → `OTP Form`, all default
Keycloak behavior, not custom) automatically requires the OTP code on every
subsequent login for that user — no custom code, this is Keycloak's built-in
OTP credential type. Only `standalone` has this; `society-events`
(event-management's realm) does not.

This exists as a 2FA measure for dashboard logins — it does **not** replace
or fix phone-number verification (see the SMS carrier-filtering limitation
above), since TOTP requires a secret already enrolled against a known
account and has no concept of a phone number at all.

## Ports

| Component | Port |
|---|---|
| Frontend (Vite dev) | 5174 |
| Backend (FastAPI) | 8000 |
| Keycloak | 8180 (admin console at `/admin`), management/health on 9000 (internal only) |
| PostgreSQL | 5433 |

Credentials and API keys (Keycloak admin, `OTP_SERVICE_API_KEY`, Cloudflare
token, etc.) live in `.env` — this file is not committed with real values in
mind, so don't copy secrets from here into git-tracked docs. SMS Gateway
Cloud Server username/password are per-gateway secrets stored in the
`sms_gateways` table via the dashboard, not in `.env`.
