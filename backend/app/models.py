import datetime
import uuid

from sqlalchemy import Column, DateTime, Integer, String, JSON

from .database import Base


def _gen_id() -> str:
    return "svc_" + uuid.uuid4().hex[:10]


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
