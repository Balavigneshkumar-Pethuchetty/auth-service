"""
OTP lifecycle: generate, send (via sms_gateway failover), verify.

State lives here rather than in Keycloak's authentication session, so there's
a durable, queryable history of every OTP issued — who requested it, how many
times it was resent, how many verification attempts were made, and which
committee phone actually delivered it. The Keycloak SMS-OTP authenticator is
a thin client of this API: it calls /api/otp/request to send a code and
/api/otp/verify to check what the user typed.
"""
import datetime
import hashlib
import logging
import secrets
import string

from sqlalchemy.orm import Session

from . import models, sms_gateway
from .config import settings

log = logging.getLogger(__name__)


def _gen_code(length: int) -> str:
    return "".join(secrets.choice(string.digits) for _ in range(length))


def _hash_code(otp_id: str, code: str) -> str:
    return hashlib.sha256(f"{otp_id}:{code}:{settings.otp_pepper}".encode()).hexdigest()


def _active_request(db: Session, phone: str) -> models.OtpRequest | None:
    return (
        db.query(models.OtpRequest)
        .filter(models.OtpRequest.phone == phone, models.OtpRequest.status == "pending")
        .order_by(models.OtpRequest.created_at.desc())
        .first()
    )


async def request_otp(db: Session, phone: str) -> dict:
    """
    Generate + send an OTP for `phone`, enforcing a per-phone resend cooldown
    and a cap on total resends. A resend reuses the same request row (instead
    of creating a new one) so attempt/resend counters and history stay
    attached to one logical login attempt.
    """
    now = datetime.datetime.utcnow()
    existing = _active_request(db, phone)

    if existing and existing.expires_at and existing.expires_at > now:
        if existing.next_resend_at and existing.next_resend_at > now:
            return {
                "ok": False,
                "error": "cooldown",
                "retry_after": int((existing.next_resend_at - now).total_seconds()),
                "request_id": existing.id,
            }
        if existing.resend_count >= existing.max_resends:
            return {"ok": False, "error": "max_resends_reached", "request_id": existing.id}
        req = existing
        req.resend_count += 1
    else:
        if existing:
            existing.status = "expired"
        req = models.OtpRequest(
            phone=phone,
            max_attempts=settings.otp_max_attempts,
            max_resends=settings.otp_max_resends,
        )
        db.add(req)
        db.flush()  # populate req.id before it's used below

    code = _gen_code(settings.otp_length)
    req.code_hash = _hash_code(req.id, code)
    req.status = "pending"
    req.attempts = 0
    req.expires_at = now + datetime.timedelta(seconds=settings.otp_ttl_seconds)
    req.last_sent_at = now
    req.next_resend_at = now + datetime.timedelta(seconds=settings.otp_resend_cooldown_seconds)
    db.commit()
    db.refresh(req)

    text = f"Your verification code is {code}. It expires in {settings.otp_ttl_seconds // 60} minutes."
    result = await sms_gateway.send_otp(db, phone, text)

    req.sent_via = result.get("via")
    for attempt in result.get("attempts", []):
        db.add(models.OtpSendLog(
            otp_request_id=req.id,
            gateway_label=attempt["gateway"],
            ok=attempt["ok"],
            error=attempt.get("error"),
        ))
    if not result.get("sent"):
        req.status = "send_failed"
    db.commit()

    return {
        "ok": bool(result.get("sent")),
        "request_id": req.id,
        "expires_in": settings.otp_ttl_seconds,
        "sent_via": req.sent_via,
        "error": None if result.get("sent") else result.get("error", "send failed"),
    }


def verify_otp(db: Session, request_id: str, code: str) -> dict:
    req = db.get(models.OtpRequest, request_id)
    if not req:
        return {"verified": False, "status": "not_found"}

    now = datetime.datetime.utcnow()

    if req.status != "pending":
        return {"verified": False, "status": req.status}

    if not req.expires_at or req.expires_at <= now:
        req.status = "expired"
        db.commit()
        return {"verified": False, "status": "expired"}

    if req.attempts >= req.max_attempts:
        req.status = "locked"
        db.commit()
        return {"verified": False, "status": "locked"}

    req.attempts += 1
    match = _hash_code(req.id, code) == req.code_hash

    if match:
        req.status = "verified"
        req.verified_at = now
        db.commit()
        return {"verified": True, "status": "verified"}

    if req.attempts >= req.max_attempts:
        req.status = "locked"
    db.commit()
    return {
        "verified": False,
        "status": req.status,
        "attempts_remaining": max(0, req.max_attempts - req.attempts),
    }


def history(db: Session, phone: str | None = None, limit: int = 50) -> list[dict]:
    q = db.query(models.OtpRequest).order_by(models.OtpRequest.created_at.desc())
    if phone:
        q = q.filter(models.OtpRequest.phone == phone)
    rows = q.limit(limit).all()

    out = []
    for r in rows:
        logs = (
            db.query(models.OtpSendLog)
            .filter(models.OtpSendLog.otp_request_id == r.id)
            .order_by(models.OtpSendLog.created_at.asc())
            .all()
        )
        out.append({
            "id": r.id,
            "phone": r.phone,
            "status": r.status,
            "attempts": r.attempts,
            "max_attempts": r.max_attempts,
            "resend_count": r.resend_count,
            "max_resends": r.max_resends,
            "sent_via": r.sent_via,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "expires_at": r.expires_at.isoformat() if r.expires_at else None,
            "verified_at": r.verified_at.isoformat() if r.verified_at else None,
            "send_log": [
                {"gateway": l.gateway_label, "ok": l.ok, "error": l.error, "at": l.created_at.isoformat() if l.created_at else None}
                for l in logs
            ],
        })
    return out
