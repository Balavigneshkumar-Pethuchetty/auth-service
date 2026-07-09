import asyncio
import hmac
import json
import os
import socket
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import httpx

import yaml
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from . import cloudflare_api, keycloak_admin, models, otp_service, schemas, sms_gateway
from .auth import get_current_user
from .config import settings
from .database import Base, SessionLocal, engine, get_db
from .tunnel import router as tunnel_router
from .websocket import manager

_background: set = set()


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def require_service_key(x_api_key: str = Header(default="")) -> None:
    """
    Auth for server-to-server callers (the Keycloak SMS-OTP authenticator SPI)
    that don't have an end-user bearer token — the whole point of this call
    is to authenticate a user who hasn't finished logging in yet.
    """
    if not settings.otp_service_api_key:
        raise HTTPException(503, "OTP service API key not configured")
    if not hmac.compare_digest(x_api_key, settings.otp_service_api_key):
        raise HTTPException(401, "invalid API key")


def get_domain(db: Session) -> str:
    row = db.get(models.Setting, "domain")
    return row.value if row else settings.domain


def set_domain(db: Session, value: str) -> None:
    row = db.get(models.Setting, "domain")
    if row:
        row.value = value
    else:
        db.add(models.Setting(key="domain", value=value))
    db.commit()


def serialize(svc: models.Service, domain: str) -> dict:
    return {
        "id": svc.id,
        "name": svc.name,
        "type": svc.type,
        "subdomain": svc.subdomain,
        "port": svc.port,
        "status": svc.status,
        "route": (svc.config or {}).get("hostname") or f"{svc.subdomain}.{domain}",
        "config": svc.config or {},
        "created_at": svc.created_at.isoformat() if svc.created_at else None,
    }


def parse_config(raw: str, filename: str) -> dict:
    raw = raw.strip()
    try:
        return json.loads(raw)
    except Exception:
        pass
    try:
        data = yaml.safe_load(raw)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {"name": filename.rsplit(".", 1)[0], "raw": raw}


def _is_port_open(host: str, port: int, timeout: float = 2.0) -> bool:
    """Return True if we can TCP-connect to host:port within timeout."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


async def _http_reachable(url: str, timeout: float = 4.0) -> bool:
    """Return True if HTTP GET returns a non-5xx response."""
    try:
        async with httpx.AsyncClient(timeout=timeout, verify=False, follow_redirects=True) as client:
            r = await client.get(url)
            return r.status_code < 500
    except Exception:
        return False


async def _check_service_health(svc: models.Service) -> bool:
    """
    Decide whether a service is reachable.
    Priority: health_url (HTTP) > skip_health (assume up) > TCP localhost:port fallback.
    """
    cfg = svc.config or {}
    health_url = cfg.get("health_url")
    if health_url:
        return await _http_reachable(health_url)
    if cfg.get("skip_health"):
        return True
    return await asyncio.get_event_loop().run_in_executor(
        None, _is_port_open, "localhost", svc.port
    )


_CONFIG_PATH = Path(os.getenv("CLOUDFLARED_CONFIG", "/etc/cloudflared/config.yml"))
_REALM_JSON_PATH = Path(os.getenv("REALM_JSON_PATH", "/opt/realm/realm.json"))


def _sync_config_yml_services(db: Session) -> None:
    """
    Read config.yml and create (or update) a Service row for every named ingress route.
    New routes are inserted; existing rows that were originally synced from config.yml
    get their service URL and health_url refreshed so stale ports are corrected on restart.
    """
    try:
        with open(_CONFIG_PATH) as f:
            cfg = yaml.safe_load(f)
    except Exception:
        return

    domain = get_domain(db)
    all_svcs = {s.subdomain: s for s in db.query(models.Service).all()}
    SKIP = {"www", "auth-api"}

    for rule in cfg.get("ingress", []):
        hostname: str = rule.get("hostname", "")
        service_url: str = rule.get("service", "")
        if not hostname or not service_url or "http_status" in service_url:
            continue

        if hostname in (domain, f"www.{domain}"):
            continue
        if not hostname.endswith(f".{domain}"):
            continue
        subdomain = hostname[: -(len(domain) + 1)]
        if not subdomain or subdomain in SKIP:
            continue

        try:
            parsed = urlparse(service_url)
            port = parsed.port or 8080
            health_url = f"{parsed.scheme}://{parsed.netloc}"
        except Exception:
            port, health_url = 8080, service_url

        if subdomain in all_svcs:
            # Re-sync URL fields for config.yml-managed services so port changes propagate.
            existing_svc = all_svcs[subdomain]
            if (existing_svc.config or {}).get("synced_from") == "config.yml":
                existing_svc.config = {
                    **existing_svc.config,
                    "service": service_url,
                    "health_url": health_url,
                }
                flag_modified(existing_svc, "config")
        else:
            db.add(models.Service(
                name=subdomain,
                type="Service",
                subdomain=subdomain,
                port=port,
                status="active",
                config={"service": service_url, "health_url": health_url, "synced_from": "config.yml"},
            ))
            all_svcs[subdomain] = None

    db.commit()


def _migrate_services(db: Session) -> None:
    """
    Idempotent fixes applied on every boot to correct stale seeded data.
    Safe to run on a live DB — only touches known service IDs.
    """
    # Remove cloudflared from dashboard — it is infrastructure, not a web service.
    # Its tunnel status is already visible in Settings > Cloudflared Tunnel.
    svc_tunnel = db.get(models.Service, "svc_tunnel")
    if svc_tunnel:
        db.delete(svc_tunnel)

    # Fix keycloak health URL — port 9000 management interface is loopback-only;
    # use the realm discovery URL on the main HTTP port.
    svc_kc = db.get(models.Service, "svc_keycloak")
    if svc_kc:
        correct_url = f"http://keycloak:8080/realms/{settings.keycloak_realm}"
        cfg = {**(svc_kc.config or {}), "health_url": correct_url}
        svc_kc.config = cfg

    # Fix event-management — seed had wrong subdomain "events"; real URL is the apex domain.
    svc_event = db.get(models.Service, "svc_event")
    if svc_event:
        cfg = {
            **(svc_event.config or {}),
            "hostname": settings.domain,
            "health_url": "http://host.containers.internal:8080",
        }
        svc_event.config = cfg

    db.commit()


def seed() -> None:
    db = SessionLocal()
    try:
        if db.query(models.Service).count() == 0:
            defaults = [
                models.Service(
                    id="svc_keycloak",
                    name="keycloak-auth",
                    type="Keycloak",
                    subdomain="auth",
                    port=8080,
                    status="active",
                    config={
                        "service": "keycloak-auth",
                        "realm": settings.keycloak_realm,
                        # Port 9000 is the KC management port but only loopback-bound;
                        # use the realm discovery URL on the main HTTP port instead.
                        "health_url": f"http://keycloak:8080/realms/{settings.keycloak_realm}",
                    },
                ),
                models.Service(
                    id="svc_event",
                    name="event-management",
                    type="Service",
                    subdomain="events",
                    port=8080,
                    status="active",
                    config={
                        "service": "event-management",
                        "hostname": settings.domain,
                        "health_url": "http://host.containers.internal:8080",
                        "note": "existing system - do not modify",
                    },
                ),
            ]
            db.add_all(defaults)
            db.commit()
        _migrate_services(db)
        _sync_config_yml_services(db)
    finally:
        db.close()


def init_db_with_retry(retries: int = 30, delay: float = 2.0) -> None:
    last = None
    for _ in range(retries):
        try:
            Base.metadata.create_all(bind=engine)
            return
        except Exception as exc:
            last = exc
            time.sleep(delay)
    raise RuntimeError(f"Could not connect to database: {last}")


# ---------------------------------------------------------------------------
# background tasks
# ---------------------------------------------------------------------------

async def _provision_service(service_id: str) -> None:
    """
    Real provisioning:
    1. Create Cloudflare DNS CNAME + update tunnel ingress (if configured).
    2. Check if the local port is reachable; set status accordingly.
    Falls back to simulated provisioning when Cloudflare is not configured.
    """
    db = SessionLocal()
    try:
        svc = db.get(models.Service, service_id)
        if not svc or svc.status != "provisioning":
            return

        domain = get_domain(db)
        cf_ok = await cloudflare_api.provision_service(svc.subdomain, svc.port)

        if cf_ok:
            # Give Cloudflare a moment to propagate.
            await asyncio.sleep(2)
        else:
            # No Cloudflare — just wait a little to simulate work.
            await asyncio.sleep(3)

        reachable = await _check_service_health(svc)
        svc.status = "active" if reachable else "degraded"
        db.commit()
        db.refresh(svc)
        await manager.broadcast({"event": "status", "service": serialize(svc, domain)})
    finally:
        db.close()


async def health_loop() -> None:
    """Periodically ping every service port and broadcast live status."""
    while True:
        await asyncio.sleep(30)
        db = SessionLocal()
        try:
            domain = get_domain(db)
            services = db.query(models.Service).all()
            changed: list[dict] = []
            for svc in services:
                if svc.status == "provisioning":
                    continue
                reachable = await _check_service_health(svc)
                new_status = "active" if reachable else "degraded"
                if new_status != svc.status:
                    svc.status = new_status
                    changed.append(serialize(svc, domain))
            if changed:
                db.commit()
                for data in changed:
                    await manager.broadcast({"event": "status", "service": data})

            # Heartbeat with full list.
            snapshot = [serialize(s, domain) for s in db.query(models.Service).all()]
            await manager.broadcast({"event": "heartbeat", "services": snapshot})
        except Exception:
            pass
        finally:
            db.close()


async def _keycloak_setup_background() -> None:
    """Wait for Keycloak then set up realm + client (non-blocking at startup)."""
    try:
        await keycloak_admin.wait_for_keycloak(timeout=180)
        await keycloak_admin.setup()
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("Keycloak setup failed: %s", exc)


# ---------------------------------------------------------------------------
# app lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db_with_retry()
    seed()
    # Keycloak setup runs in background — the app starts serving immediately.
    kc_task = asyncio.create_task(_keycloak_setup_background())
    hl_task = asyncio.create_task(health_loop())
    _background.update({kc_task, hl_task})
    yield
    kc_task.cancel()
    hl_task.cancel()


app = FastAPI(title="Standalone Services API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tunnel_router)


# ---------------------------------------------------------------------------
# public endpoints (no auth)
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/auth/keycloak-config")
def keycloak_config():
    """Frontend reads this to configure keycloak-js without hardcoding URLs."""
    public_url = settings.keycloak_public_url or settings.keycloak_url.replace("keycloak", "localhost")
    return {
        "url": public_url,
        "realm": settings.keycloak_realm,
        "clientId": settings.keycloak_client_id,
    }


# ---------------------------------------------------------------------------
# authenticated endpoints
# ---------------------------------------------------------------------------

@app.get("/api/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return {
        "sub": user.get("sub"),
        "username": user.get("preferred_username"),
        "email": user.get("email"),
        "name": user.get("name"),
        "roles": user.get("realm_access", {}).get("roles", []),
    }


@app.get("/api/infra/status")
async def infra_status(_user: dict = Depends(get_current_user)):
    """Live connectivity state of Keycloak and Cloudflare."""
    kc_ok = bool(keycloak_admin.get_cached_jwks())
    cf_status = await cloudflare_api.get_tunnel_status()
    return {
        "keycloak": {
            "configured": keycloak_admin.is_configured(),
            "ready": kc_ok,
            "url": settings.keycloak_url,
            "public_url": settings.keycloak_public_url or settings.keycloak_url.replace("keycloak", "localhost"),
            "realm": settings.keycloak_realm,
            "client_id": settings.keycloak_client_id,
            "jwks_keys": len(keycloak_admin.get_cached_jwks()),
        },
        "cloudflare": cf_status,
    }


# ---------------------------------------------------------------------------
# config CRUD
# ---------------------------------------------------------------------------

@app.get("/api/config/list")
def list_services(
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    domain = get_domain(db)
    return [serialize(s, domain) for s in db.query(models.Service).order_by(models.Service.created_at.desc()).all()]


@app.get("/api/config/status/{service_id}")
def service_status(
    service_id: str,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    svc = db.get(models.Service, service_id)
    if not svc:
        raise HTTPException(404, "service not found")
    return {"id": svc.id, "status": svc.status, "route": f"{svc.subdomain}.{get_domain(db)}"}


@app.post("/api/config/setup", response_model=schemas.ServiceOut)
async def setup_service(
    payload: schemas.ServiceCreate,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    svc = models.Service(
        name=payload.name,
        type=payload.type,
        subdomain=payload.subdomain,
        port=payload.port,
        status="provisioning",
        config=payload.config or payload.model_dump(),
    )
    db.add(svc)
    db.commit()
    db.refresh(svc)
    data = serialize(svc, get_domain(db))
    await manager.broadcast({"event": "created", "service": data})
    task = asyncio.create_task(_provision_service(svc.id))
    _background.add(task)
    task.add_done_callback(_background.discard)
    return data


@app.post("/api/config/upload", response_model=schemas.ServiceOut)
async def upload_config(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    raw = (await file.read()).decode("utf-8", errors="replace")
    data = parse_config(raw, file.filename or "config.json")
    name = str(data.get("service") or data.get("name") or (file.filename or "service").rsplit(".", 1)[0])
    subdomain = str(data.get("subdomain") or data.get("sub") or name)
    try:
        port = int(data.get("port", 8080) or 8080)
    except (TypeError, ValueError):
        port = 8080
    svc = models.Service(
        name=name,
        type=str(data.get("type", "Cloudflared")),
        subdomain=subdomain,
        port=port,
        status="provisioning",
        config=data,
    )
    db.add(svc)
    db.commit()
    db.refresh(svc)
    out = serialize(svc, get_domain(db))
    await manager.broadcast({"event": "created", "service": out})
    task = asyncio.create_task(_provision_service(svc.id))
    _background.add(task)
    task.add_done_callback(_background.discard)
    return out


@app.delete("/api/config/delete/{service_id}")
async def delete_service(
    service_id: str,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    svc = db.get(models.Service, service_id)
    if not svc:
        raise HTTPException(404, "service not found")
    if (svc.config or {}).get("note", "").startswith("existing system"):
        raise HTTPException(403, "this service is protected")
    # Remove Cloudflare DNS + tunnel ingress (best-effort).
    await cloudflare_api.deprovision_service(svc.subdomain)
    db.delete(svc)
    db.commit()
    await manager.broadcast({"event": "deleted", "id": service_id})
    return {"deleted": service_id}


# ---------------------------------------------------------------------------
# keycloak realm
# ---------------------------------------------------------------------------

@app.get("/api/keycloak/realm")
async def get_realm(_user: dict = Depends(get_current_user)):
    """Export the current realm config from the live Keycloak instance."""
    try:
        return await keycloak_admin.export_realm()
    except Exception as exc:
        raise HTTPException(503, f"Could not export realm from Keycloak: {exc}")


@app.get("/api/keycloak/realm-file")
def get_realm_file(_user: dict = Depends(get_current_user)):
    """Read the physical realm.json file (used for Keycloak import on fresh build)."""
    try:
        return json.loads(_REALM_JSON_PATH.read_text())
    except FileNotFoundError:
        raise HTTPException(404, "realm.json not found — is the volume mounted in the backend?")
    except json.JSONDecodeError as exc:
        raise HTTPException(422, f"Invalid JSON in realm.json: {exc}")


@app.put("/api/keycloak/realm-file")
def save_realm_file(payload: dict, _user: dict = Depends(get_current_user)):
    """Overwrite the physical realm.json file. Changes apply on next clean rebuild."""
    try:
        _REALM_JSON_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
        return {"saved": True}
    except Exception as exc:
        raise HTTPException(500, f"Could not write realm.json: {exc}")


@app.post("/api/keycloak/realm-export-to-file")
async def export_realm_to_file(_user: dict = Depends(get_current_user)):
    """Pull the live realm config from Keycloak admin API and save it to realm.json."""
    try:
        realm = await keycloak_admin.export_realm()
        _REALM_JSON_PATH.write_text(json.dumps(realm, indent=2, ensure_ascii=False))
        return {"saved": True, "realm": realm.get("realm")}
    except Exception as exc:
        raise HTTPException(500, f"Export failed: {exc}")


# ---------------------------------------------------------------------------
# SMS gateways (OTP delivery via committee phones, over Tailscale)
# ---------------------------------------------------------------------------

def _serialize_gateway(gw: models.SmsGateway) -> dict:
    return {
        "id": gw.id,
        "label": gw.label,
        "host": gw.host,
        "port": gw.port,
        "username": gw.username,
        "priority": gw.priority,
        "enabled": gw.enabled,
        "last_status": gw.last_status,
        "last_checked_at": gw.last_checked_at.isoformat() if gw.last_checked_at else None,
        "created_at": gw.created_at.isoformat() if gw.created_at else None,
    }


@app.get("/api/sms-gateways")
def list_sms_gateways(
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    gateways = db.query(models.SmsGateway).order_by(models.SmsGateway.priority.asc()).all()
    return [_serialize_gateway(g) for g in gateways]


@app.post("/api/sms-gateways", response_model=schemas.SmsGatewayOut)
def create_sms_gateway(
    payload: schemas.SmsGatewayCreate,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    gw = models.SmsGateway(**payload.model_dump())
    db.add(gw)
    db.commit()
    db.refresh(gw)
    return _serialize_gateway(gw)


@app.patch("/api/sms-gateways/{gateway_id}", response_model=schemas.SmsGatewayOut)
def update_sms_gateway(
    gateway_id: str,
    payload: schemas.SmsGatewayUpdate,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    gw = db.get(models.SmsGateway, gateway_id)
    if not gw:
        raise HTTPException(404, "gateway not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(gw, field, value)
    db.commit()
    db.refresh(gw)
    return _serialize_gateway(gw)


@app.delete("/api/sms-gateways/{gateway_id}")
def delete_sms_gateway(
    gateway_id: str,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    gw = db.get(models.SmsGateway, gateway_id)
    if not gw:
        raise HTTPException(404, "gateway not found")
    db.delete(gw)
    db.commit()
    return {"deleted": gateway_id}


@app.post("/api/sms-gateways/{gateway_id}/ping")
async def ping_sms_gateway(
    gateway_id: str,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    return await sms_gateway.ping(db, gateway_id)


@app.post("/api/sms-gateways/test-send")
async def test_send_sms(
    payload: schemas.SmsSendRequest,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Manually trigger a send through the failover chain from the dashboard
    (JWT-authenticated) — used to verify a gateway is actually working."""
    return await sms_gateway.send_otp(db, payload.phone, payload.message)


@app.post("/api/sms/send")
async def send_sms(
    payload: schemas.SmsSendRequest,
    db: Session = Depends(get_db),
    _key: None = Depends(require_service_key),
):
    """Machine-to-machine send for other projects (e.g. event-management's
    own OTP service) that own their own OTP generation/verification and just
    need a transport. Auth is the shared service API key, not a dashboard JWT."""
    return await sms_gateway.send_otp(db, payload.phone, payload.message)


# ---------------------------------------------------------------------------
# event-management OTP transactions (cross-project dashboard proxy)
# ---------------------------------------------------------------------------

@app.get("/api/event-otp/transactions")
async def event_management_otp_transactions(_user: dict = Depends(get_current_user)):
    """
    Proxies event-management's otp-service transaction rollup so the shared
    dashboard can show real login OTP activity, without exposing the
    cross-service shared key to the browser (the JWT gate here is what the
    rest of this dashboard already relies on).
    """
    url = "http://host.containers.internal:8080/api/otp/transactions"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, headers={"X-Auth-Service-Key": settings.otp_service_api_key})
            r.raise_for_status()
            return r.json()
    except Exception as exc:
        raise HTTPException(502, f"Could not reach event-management otp-service: {exc}")


# ---------------------------------------------------------------------------
# OTP verification (auth-service's own turnkey OTP lifecycle, for future
# projects that don't want to build their own OTP generation/verification —
# event-management uses its own, and only calls /api/sms/send above)
# ---------------------------------------------------------------------------

@app.post("/api/otp/request")
async def otp_request(
    payload: schemas.OtpRequestCreate,
    db: Session = Depends(get_db),
    _key: None = Depends(require_service_key),
):
    phone = payload.phone.strip()
    if not phone:
        raise HTTPException(400, "phone is required")

    result = await otp_service.request_otp(db, phone)

    if result.get("error") == "cooldown":
        raise HTTPException(429, {"error": "cooldown", "retry_after": result["retry_after"]})
    if result.get("error") == "max_resends_reached":
        raise HTTPException(429, {"error": "max_resends_reached"})
    return result


@app.post("/api/otp/verify")
def otp_verify(
    payload: schemas.OtpVerifyRequest,
    db: Session = Depends(get_db),
    _key: None = Depends(require_service_key),
):
    return otp_service.verify_otp(db, payload.request_id, payload.code)


@app.get("/api/otp/history")
def otp_history(
    phone: Optional[str] = None,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    """Dashboard-facing audit view — uses normal admin login, not the service key."""
    return otp_service.history(db, phone)


# ---------------------------------------------------------------------------
# settings
# ---------------------------------------------------------------------------

@app.get("/api/config/settings")
def get_settings(
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    return {"domain": get_domain(db)}


@app.put("/api/config/settings")
async def update_settings(
    payload: schemas.DomainUpdate,
    db: Session = Depends(get_db),
    _user: dict = Depends(get_current_user),
):
    domain = payload.domain.strip().lower().replace("https://", "").replace("http://", "").split("/")[0]
    if not domain or "." not in domain:
        raise HTTPException(400, "a valid domain is required")
    set_domain(db, domain)
    services = [serialize(s, domain) for s in db.query(models.Service).all()]
    await manager.broadcast({"event": "heartbeat", "services": services})
    return {"domain": domain}


# ---------------------------------------------------------------------------
# realtime
# ---------------------------------------------------------------------------

@app.websocket("/ws/status")
async def ws_status(ws: WebSocket):
    await manager.connect(ws)
    db = SessionLocal()
    try:
        domain = get_domain(db)
        snapshot = [serialize(s, domain) for s in db.query(models.Service).all()]
        await ws.send_text(json.dumps({"event": "heartbeat", "services": snapshot}, default=str))
    finally:
        db.close()
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)
