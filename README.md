# Standalone Services Suite

A centralized management portal for standalone services (Keycloak & Cloudflared),
with a **React** frontend, a **FastAPI** backend, **PostgreSQL** storage, **Keycloak**
for auth, and **realtime status updates over WebSockets**. Built to run locally with
**Podman** on WSL2.

```
[React + Vite] ──HTTP/WS──> [FastAPI] ──> [PostgreSQL]
                                 │
                          [Keycloak]  (+ optional Cloudflared)
```

---

## Prerequisites

You said you already have WSL2 + Podman running. You also need **podman-compose**:

```bash
# inside WSL2
pip3 install podman-compose
# verify
podman-compose version
```

(If you prefer the built-in `podman compose` subcommand it works too — just swap the
command in the steps below.)

---

## Run it

```bash
# 1. extract the zip, then:
cd standalone-services-suite

# 2. (optional) copy env defaults — the compose file already has sane defaults
cp .env.example .env

# 3. build & start everything
podman-compose up --build
```

First build pulls images and installs deps, so give it a few minutes. When it settles:

| Service        | URL                              | Notes                                |
| -------------- | -------------------------------- | ------------------------------------ |
| **Frontend**   | http://localhost:5173            | the dashboard — start here           |
| **Backend API**| http://localhost:8000            | REST API                             |
| **API docs**   | http://localhost:8000/docs       | interactive Swagger UI               |
| **Keycloak**   | http://localhost:8080            | admin console (admin / admin)        |
| **PostgreSQL** | localhost:5432                   | postgres / postgres, db `standalone` |

Log in on the frontend with any email/password (the button simulates the Keycloak
redirect — see "Wiring real Keycloak" below to make it real).

### Try the realtime flow
1. Open the dashboard in **two browser tabs**.
2. In one tab go to **Upload Config → "Use sample config"** (or drop the included
   `frontend/sample-config.json`).
3. Watch the new service appear as **Provisioning** and flip to **Active** in *both*
   tabs within a few seconds — pushed over the WebSocket, no refresh.
4. Change the domain in **Settings** and watch every service route update live.

### Stop / reset

```bash
podman-compose down          # stop
podman-compose down -v       # stop AND wipe the database volume
```

---

## API endpoints

| Method | Path                          | Description                       |
| ------ | ----------------------------- | --------------------------------- |
| GET    | `/api/config/list`            | list all services                 |
| POST   | `/api/config/setup`           | register a service from JSON body |
| POST   | `/api/config/upload`          | register from an uploaded file    |
| GET    | `/api/config/status/{id}`     | service health/status             |
| DELETE | `/api/config/delete/{id}`     | remove a service                  |
| GET    | `/api/config/settings`        | get current domain                |
| PUT    | `/api/config/settings`        | update domain (broadcasts live)   |
| WS     | `/ws/status`                  | realtime service updates          |

---

## Project layout

```
standalone-services-suite/
├── podman-compose.yml
├── .env.example
├── backend/                 FastAPI + SQLAlchemy
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py          routes, websocket, provisioning simulation
│       ├── models.py        Service + Setting tables
│       ├── schemas.py
│       ├── database.py
│       ├── websocket.py     connection manager / broadcast
│       └── config.py
└── frontend/                React + Vite + Tailwind
    ├── Dockerfile
    ├── package.json
    └── src/
        ├── App.jsx          routes
        ├── lib/api.js       axios client
        ├── lib/services.jsx realtime context (WS + auto-reconnect)
        ├── components/      Layout, StatusPill
        └── pages/           Login, Dashboard, Upload, Detail, Settings
```

---

## Wiring real Keycloak (optional)

The login screen currently simulates the SSO redirect so the app runs out of the box.
To use real Keycloak auth:

1. Open http://localhost:8080 → log in (admin / admin).
2. Create a realm `standalone`, a public client (e.g. `portal-frontend`) with redirect
   URI `http://localhost:5173/*`.
3. In the frontend, add `keycloak-js`, initialize it in `main.jsx`, and gate routes on
   the authenticated token instead of the `localStorage` flag in `App.jsx`.
4. On the backend, validate the bearer token (e.g. with `python-jose`) against the
   realm's public key in a FastAPI dependency.

## Enabling Cloudflared (optional)

You need a tunnel token from your Cloudflare dashboard
(Zero Trust → Networks → Tunnels). Put it in `.env` as `TUNNEL_TOKEN=...`, then
uncomment the `cloudflared` service block in `podman-compose.yml` and re-run
`podman-compose up`.

---

## Troubleshooting

- **`podman-compose: command not found`** → `pip3 install podman-compose`.
- **Frontend can't reach the API** → confirm `backend` is healthy at
  http://localhost:8000/health. The browser talks to `localhost:8000` directly, so the
  ports must be published (they are, in the compose file).
- **`depends_on` health conditions** → podman-compose support varies; the backend
  retries the DB connection on startup for ~60s, so order isn't critical.
- **Port already in use** → change the left-hand side of the `ports:` mappings in
  `podman-compose.yml` (e.g. `"5174:5173"`).
- **SELinux volume errors** on some distros → add `:Z` to the volume mount, e.g.
  `pgdata:/var/lib/postgresql/data:Z`.
- **Rootless Podman networking** → service-to-service DNS (`db`, `backend`) works on
  the default compose network; if names don't resolve, run
  `podman network ls` and ensure the project network was created.
