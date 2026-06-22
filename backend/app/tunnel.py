import asyncio
import os
from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import get_current_user

CONFIG_PATH = Path(os.getenv("CLOUDFLARED_CONFIG", "/etc/cloudflared/config.yml"))
CONTAINER_NAME = os.getenv("CLOUDFLARED_CONTAINER", "auth-service_cloudflared_1")
SOCKET_PATH = os.getenv("PODMAN_SOCKET", "/var/run/podman/podman.sock")

router = APIRouter(prefix="/api/tunnel", tags=["tunnel"])


class IngressRule(BaseModel):
    hostname: str
    service: str


class ServiceUpdate(BaseModel):
    service: str


def _read_config() -> dict:
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


def _write_config(cfg: dict) -> None:
    with open(CONFIG_PATH, "w") as f:
        yaml.dump(cfg, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def _named_routes(cfg: dict) -> list[dict]:
    return [r for r in cfg.get("ingress", []) if "hostname" in r]


def _restart_container() -> str | None:
    """Restart the cloudflared container via Podman socket. Returns error string on failure."""
    try:
        import docker
        client = docker.DockerClient(base_url=f"unix://{SOCKET_PATH}")
        client.containers.get(CONTAINER_NAME).restart()
        client.close()
        return None
    except Exception as exc:
        return str(exc)


@router.get("/routes")
def list_routes(_user: dict = Depends(get_current_user)):
    try:
        cfg = _read_config()
    except FileNotFoundError:
        raise HTTPException(404, "config.yml not found — is the cloudflared volume mounted in the backend?")
    return {"routes": _named_routes(cfg)}


@router.post("/routes", status_code=201)
async def add_route(rule: IngressRule, _user: dict = Depends(get_current_user)):
    rule.hostname = rule.hostname.strip().lower()
    rule.service = rule.service.strip()
    if not rule.hostname or not rule.service:
        raise HTTPException(400, "hostname and service are required")

    try:
        cfg = _read_config()
    except FileNotFoundError:
        raise HTTPException(404, "config.yml not found")

    ingress = cfg.get("ingress", [])
    if any(r.get("hostname") == rule.hostname for r in ingress):
        raise HTTPException(409, f"Hostname '{rule.hostname}' already exists")

    # Insert before the catch-all rule (the one without a hostname)
    catch_all_idx = next((i for i, r in enumerate(ingress) if "hostname" not in r), len(ingress))
    ingress.insert(catch_all_idx, {"hostname": rule.hostname, "service": rule.service})
    cfg["ingress"] = ingress
    _write_config(cfg)

    restart_error = await asyncio.get_event_loop().run_in_executor(None, _restart_container)
    return {"routes": _named_routes(cfg), "restart_error": restart_error}


@router.patch("/routes/{hostname:path}")
async def update_route(hostname: str, body: ServiceUpdate, _user: dict = Depends(get_current_user)):
    new_service = body.service.strip()
    if not new_service:
        raise HTTPException(400, "service URL is required")

    try:
        cfg = _read_config()
    except FileNotFoundError:
        raise HTTPException(404, "config.yml not found")

    ingress = cfg.get("ingress", [])
    updated = False
    for rule in ingress:
        if rule.get("hostname") == hostname:
            rule["service"] = new_service
            updated = True
            break

    if not updated:
        raise HTTPException(404, f"Hostname '{hostname}' not found")

    cfg["ingress"] = ingress
    _write_config(cfg)

    restart_error = await asyncio.get_event_loop().run_in_executor(None, _restart_container)
    return {"routes": _named_routes(cfg), "restart_error": restart_error}


@router.delete("/routes/{hostname:path}")
async def delete_route(hostname: str, _user: dict = Depends(get_current_user)):
    try:
        cfg = _read_config()
    except FileNotFoundError:
        raise HTTPException(404, "config.yml not found")

    ingress = cfg.get("ingress", [])
    new_ingress = [r for r in ingress if r.get("hostname") != hostname]
    if len(new_ingress) == len(ingress):
        raise HTTPException(404, f"Hostname '{hostname}' not found")

    cfg["ingress"] = new_ingress
    _write_config(cfg)

    restart_error = await asyncio.get_event_loop().run_in_executor(None, _restart_container)
    return {"routes": _named_routes(cfg), "restart_error": restart_error}
