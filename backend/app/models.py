import datetime
import uuid

from sqlalchemy import Boolean, Column, DateTime, Integer, String, JSON

from .database import Base


def _gen_id() -> str:
    return "svc_" + uuid.uuid4().hex[:10]


def _gen_gateway_id() -> str:
    return "gw_" + uuid.uuid4().hex[:10]


def _gen_otp_id() -> str:
    return "otp_" + uuid.uuid4().hex[:12]


class Service(Base):
    __tablename__ = "services"

    id = Column(String, primary_key=True, default=_gen_id)
    name = Column(String, nullable=False)
    type = Column(String, default="Service")
    subdomain = Column(String, nullable=False)
    port = Column(Integer, default=8080)
    status = Column(String, default="provisioning")  # provisioning | active | degraded | stopped
    config = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class Setting(Base):
    __tablename__ = "settings"

    key = Column(String, primary_key=True)
    value = Column(String)


class SmsGateway(Base):
    """
    A committee member's phone running the SMS Gateway for Android app in
    local-server mode, reached over Tailscale. Multiple rows form the
    configurable, ordered fallback list used for OTP delivery.
    """
    __tablename__ = "sms_gateways"

    id = Column(String, primary_key=True, default=_gen_gateway_id)
    label = Column(String, nullable=False)
    host = Column(String, nullable=False)  # Tailscale IP or MagicDNS name
    port = Column(Integer, default=8080)
    username = Column(String, nullable=False)
    password = Column(String, nullable=False)
    priority = Column(Integer, default=100)  # lower = tried first
    enabled = Column(Boolean, default=True)
    last_status = Column(String, default="unknown")  # unknown | online | unreachable
    last_checked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class OtpRequest(Base):
    """
    One logical OTP challenge for a phone number. Resends reuse the same row
    (incrementing resend_count) so history and attempt counts stay attached
    to a single login attempt instead of scattering across rows.
    """
    __tablename__ = "otp_requests"

    id = Column(String, primary_key=True, default=_gen_otp_id)
    phone = Column(String, nullable=False, index=True)
    code_hash = Column(String, nullable=True)
    status = Column(String, default="pending")  # pending | verified | expired | send_failed | locked
    attempts = Column(Integer, default=0)
    max_attempts = Column(Integer, default=5)
    resend_count = Column(Integer, default=0)
    max_resends = Column(Integer, default=3)
    sent_via = Column(String, nullable=True)  # gateway label that delivered it
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    expires_at = Column(DateTime, nullable=True)
    last_sent_at = Column(DateTime, nullable=True)
    next_resend_at = Column(DateTime, nullable=True)  # resend cooldown
    verified_at = Column(DateTime, nullable=True)


class OtpSendLog(Base):
    """Per-attempt delivery history — which gateway was tried and the result."""
    __tablename__ = "otp_send_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    otp_request_id = Column(String, nullable=False, index=True)
    gateway_label = Column(String, nullable=True)
    ok = Column(Boolean, default=False)
    error = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
