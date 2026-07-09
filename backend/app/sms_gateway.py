"""
SMS OTP relay via self-hosted Android SMS Gateway devices.

Devices are committee members' phones running the open-source "SMS Gateway
for Android" app (capcom6/android-sms-gateway) in local-server mode, reached
over Tailscale rather than the public internet. The Tailscale sidecar
container exposes a SOCKS5 proxy (see podman-compose.yml) since this
container never joins the tailnet directly.

Gateways are tried in priority order (see models.SmsGateway); the first one
that accepts the request wins, so a phone that's offline or unreachable is
skipped automatically without any manual intervention.
"""
import datetime
import logging

import httpx
from sqlalchemy.orm import Session

from . import models

log = logging.getLogger(__name__)

_PROXY = "socks5://tailscale:1055"
_TIMEOUT = 10.0


def _gateway_url(gw: models.SmsGateway, path: str) -> str:
    return f"http://{gw.host}:{gw.port}{path}"


async def ping(db: Session, gateway_id: str) -> dict:
    """Check a single gateway's /health endpoint without sending an SMS."""
    gw = db.get(models.SmsGateway, gateway_id)
    if not gw:
        return {"reachable": False, "error": "gateway not found"}

    reachable = False
    error = None
    try:
        async with httpx.AsyncClient(proxy=_PROXY, timeout=_TIMEOUT, verify=False) as client:
            r = await client.get(_gateway_url(gw, "/health"), auth=(gw.username, gw.password))
            reachable = r.status_code < 300
            if not reachable:
                error = f"HTTP {r.status_code}"
    except Exception as exc:
        error = str(exc)

    gw.last_status = "online" if reachable else "unreachable"
    gw.last_checked_at = datetime.datetime.utcnow()
    db.commit()
    return {"reachable": reachable, "error": error}


async def _try_send(client: httpx.AsyncClient, gw: models.SmsGateway, phone: str, text: str) -> tuple[bool, str | None]:
    try:
        r = await client.post(
            _gateway_url(gw, "/messages"),
            json={"phoneNumbers": [phone], "message": text},
            auth=(gw.username, gw.password),
        )
        if r.status_code < 300:
            return True, None
        return False, f"HTTP {r.status_code}: {r.text[:200]}"
    except Exception as exc:
        return False, str(exc)


async def send_otp(db: Session, phone: str, text: str) -> dict:
    """
    Try each enabled gateway in priority order until one accepts the message.
    Returns {"sent": bool, "via": label|None, "attempts": [...]}.
    """
    gateways = (
        db.query(models.SmsGateway)
        .filter(models.SmsGateway.enabled == True)  # noqa: E712
        .order_by(models.SmsGateway.priority.asc())
        .all()
    )
    if not gateways:
        return {"sent": False, "via": None, "attempts": [], "error": "no SMS gateways configured"}

    attempts = []
    async with httpx.AsyncClient(proxy=_PROXY, timeout=_TIMEOUT, verify=False) as client:
        for gw in gateways:
            ok, error = await _try_send(client, gw, phone, text)
            now = datetime.datetime.utcnow()
            gw.last_status = "online" if ok else "unreachable"
            gw.last_checked_at = now
            attempts.append({"gateway": gw.label, "ok": ok, "error": error})
            if ok:
                db.commit()
                return {"sent": True, "via": gw.label, "attempts": attempts}
        db.commit()

    return {"sent": False, "via": None, "attempts": attempts, "error": "all gateways unreachable"}
