from datetime import datetime
from typing import Any, Dict, Optional

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
    host: str
    port: int = 8080
    username: str
    password: str
    priority: int = 100
    enabled: bool = True


class SmsGatewayUpdate(BaseModel):
    label: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    username: Optional[str] = None
    password: Optional[str] = None
    priority: Optional[int] = None
    enabled: Optional[bool] = None


class SmsGatewayOut(BaseModel):
    id: str
    label: str
    host: str
    port: int
    username: str
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


class OtpVerifyRequest(BaseModel):
    request_id: str
    code: str
