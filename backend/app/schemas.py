from datetime import datetime
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel


class ServiceCreate(BaseModel):
    name: str
    type: str = "Service"
    subdomain: str
    port: int = 8080
    config: Dict[str, Any] = {}


class DomainUpdate(BaseModel):
    domain: str


class ServiceOut(BaseModel):
    id: str
    name: str
    type: str
    subdomain: str
    port: int
    status: str
    route: str
    config: Dict[str, Any]
    created_at: Optional[datetime] = None


class SmsGatewayCreate(BaseModel):
    label: str
    username: str
    password: str
    device_id: str
    priority: int = 100
    enabled: bool = True


class SmsGatewayUpdate(BaseModel):
    label: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    device_id: Optional[str] = None
    priority: Optional[int] = None
    enabled: Optional[bool] = None


class SmsGatewayOut(BaseModel):
    id: str
    label: str
    username: str
    device_id: str
    priority: int
    enabled: bool
    last_status: str
    last_checked_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class SmsSendRequest(BaseModel):
    phone: str
    message: str


class OtpRequestCreate(BaseModel):
    phone: str
    # None = automatic (Telegram if linked, else SMS — otp_service.py's
    # existing default behavior). Explicit values opt out of that fallback.
    channel: Optional[Literal["telegram", "sms"]] = None


class OtpVerifyRequest(BaseModel):
    request_id: str
    code: str
