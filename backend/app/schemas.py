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
