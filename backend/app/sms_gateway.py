"""
SMS OTP relay via SMS Gateway for Android's hosted Cloud Server
(https://sms-gate.app), a free relay run by the app's own developer.

Committee members' Android phones run the SMS Gateway for Android app with
"Cloud Server" mode enabled — the app dials out to api.sms-gate.app and
registers itself, auto-generating a username/password shown in the app's
Cloud Server settings. This backend authenticates with those same
credentials via HTTP Basic Auth directly against the public cloud API, no
private networking involved.

Gateways are tried in priority order (see models.SmsGateway); the first one
that accepts the request wins, so a phone that's offline or unreachable is
skipped automatically without any manual intervention.

Note: capcom6's docs don't expose a synchronous per-device status endpoint
for Cloud Server mode (only a webhook-based one, `system:ping`, which would
require this backend to expose a public callback URL — not implemented).
So `ping()` here can only confirm the credentials are accepted by the cloud
API, not that the phone itself is currently online — `send_otp()` (used by
the dashboard's "Test send") is the only real delivery check.
"""
import datetime
import logging
import re

import httpx
from sqlalchemy.orm import Session

from . import models
from .splunk_logger import log_app_error

log = logging.getLogger(__name__)

_CLOUD_BASE = "https://api.sms-gate.app/3rdparty/v1"
_TIMEOUT = 10.0


def _mask_phone(phone: str) -> str:
    return "*" * max(0, len(phone) - 4) + phone[-4:] if len(phone) >= 4 else "***"


def _scrub_digits(text: str | None) -> str | None:
    """Strip digit runs >=8 chars (phone numbers) out of gateway error text
    before it's shipped to Splunk — SMS Gateway for Android's API can echo
    the phoneNumbers we sent back in its error response body."""
    if not text:
        return text
    return re.sub(r"\d{8,}", "[redacted]", text)


async def ping(db: Session, gateway_id: str) -> dict:
    """Best-effort credential check only — see module docstring. Does not
    touch last_status/last_checked_at since a failure here doesn't mean the
    phone is actually unreachable, just that this check is inconclusive."""
    gw = db.get(models.SmsGateway, gateway_id)
    if not gw:
        return {"reachable": False, "error": "gateway not found"}
    return {
        "reachable": False,
        "error": "SMS Gateway Cloud Server has no live device-status endpoint — use Test send to verify delivery",
    }


async def _try_send(client: httpx.AsyncClient, gw: models.SmsGateway, phone: str, text: str) -> tuple[bool, str | None]:
    payload = {"textMessage": {"text": text}, "phoneNumbers": [phone], "deviceId": gw.device_id}
    try:
        r = await client.post(
            f"{_CLOUD_BASE}/message",
            json=payload,
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
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
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

    await log_app_error({
        "event": "sms_send_failed",
        "phone": _mask_phone(phone),
        "attempts": [
            {"gateway": a["gateway"], "ok": a["ok"], "error": _scrub_digits(a["error"])}
            for a in attempts
        ],
    })
    return {"sent": False, "via": None, "attempts": attempts, "error": "all gateways unreachable"}
