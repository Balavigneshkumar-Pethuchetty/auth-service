"""
Cloudflare REST API client.

Manages:
- DNS CNAME records  (subdomain.domain → <tunnel-id>.cfargotunnel.com)
- Cloudflared tunnel ingress config  (Zero Trust API approach)

All methods are no-ops when CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID are empty,
so the app degrades gracefully without credentials.
"""
import logging
from typing import Any

import httpx

from .config import settings

log = logging.getLogger(__name__)

_CF_BASE = "https://api.cloudflare.com/client/v4"
_CATCH_ALL = {"service": "http_status:404"}


def is_enabled() -> bool:
    return bool(settings.cloudflare_api_token and settings.cloudflare_zone_id)


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.cloudflare_api_token}",
        "Content-Type": "application/json",
    }


# ---------------------------------------------------------------------------
# DNS helpers
# ---------------------------------------------------------------------------

async def _list_dns_records(client: httpx.AsyncClient, name: str) -> list[dict]:
    r = await client.get(
        f"{_CF_BASE}/zones/{settings.cloudflare_zone_id}/dns_records",
        params={"type": "CNAME", "name": name},
        headers=_headers(),
    )
    r.raise_for_status()
    return r.json().get("result", [])


async def _create_cname(client: httpx.AsyncClient, name: str, target: str) -> None:
    existing = await _list_dns_records(client, name)
    if existing:
        # Update in place.
        record_id = existing[0]["id"]
        await client.put(
            f"{_CF_BASE}/zones/{settings.cloudflare_zone_id}/dns_records/{record_id}",
            json={"type": "CNAME", "name": name, "content": target, "proxied": True, "ttl": 1},
            headers=_headers(),
        )
        log.info("Cloudflare: CNAME '%s' updated → %s", name, target)
    else:
        r = await client.post(
            f"{_CF_BASE}/zones/{settings.cloudflare_zone_id}/dns_records",
            json={"type": "CNAME", "name": name, "content": target, "proxied": True, "ttl": 1},
            headers=_headers(),
        )
        r.raise_for_status()
        log.info("Cloudflare: CNAME '%s' created → %s", name, target)


async def _delete_cname(client: httpx.AsyncClient, name: str) -> None:
    records = await _list_dns_records(client, name)
    for rec in records:
        await client.delete(
            f"{_CF_BASE}/zones/{settings.cloudflare_zone_id}/dns_records/{rec['id']}",
            headers=_headers(),
        )
        log.info("Cloudflare: CNAME '%s' deleted.", name)


# ---------------------------------------------------------------------------
# Tunnel ingress helpers (Zero Trust managed config)
# ---------------------------------------------------------------------------

async def _get_tunnel_config(client: httpx.AsyncClient) -> dict[str, Any]:
    if not settings.cloudflare_tunnel_id:
        return {"ingress": [_CATCH_ALL]}
    r = await client.get(
        f"{_CF_BASE}/accounts/{settings.cloudflare_account_id}"
        f"/cfd_tunnel/{settings.cloudflare_tunnel_id}/configurations",
        headers=_headers(),
    )
    r.raise_for_status()
    cfg = r.json().get("result", {}).get("config", {})
    ingress = cfg.get("ingress", [_CATCH_ALL])
    return {"ingress": ingress}


async def _put_tunnel_config(client: httpx.AsyncClient, config: dict[str, Any]) -> None:
    if not settings.cloudflare_tunnel_id:
        return
    # Ensure catch-all is always last.
    ingress = [r for r in config["ingress"] if r != _CATCH_ALL] + [_CATCH_ALL]
    r = await client.put(
        f"{_CF_BASE}/accounts/{settings.cloudflare_account_id}"
        f"/cfd_tunnel/{settings.cloudflare_tunnel_id}/configurations",
        json={"config": {"ingress": ingress}},
        headers=_headers(),
    )
    r.raise_for_status()
    log.info("Cloudflare: tunnel ingress updated (%d rules).", len(ingress))


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def provision_service(subdomain: str, port: int) -> bool:
    """
    Create CNAME + add ingress rule for a new service.
    Returns True on success, False when Cloudflare is not configured.
    """
    if not is_enabled():
        log.info("Cloudflare not configured — skipping DNS/tunnel provisioning.")
        return False

    domain = settings.domain
    fqdn = f"{subdomain}.{domain}"
    tunnel_hostname = f"{settings.cloudflare_tunnel_id}.cfargotunnel.com"

    async with httpx.AsyncClient(timeout=15) as client:
        await _create_cname(client, fqdn, tunnel_hostname)

        cfg = await _get_tunnel_config(client)
        # Remove existing rule for this hostname (idempotent).
        cfg["ingress"] = [r for r in cfg["ingress"] if r.get("hostname") != fqdn]
        cfg["ingress"].insert(
            0,
            {"hostname": fqdn, "service": f"http://localhost:{port}"},
        )
        await _put_tunnel_config(client, cfg)

    return True


async def deprovision_service(subdomain: str) -> bool:
    """
    Remove CNAME + ingress rule when a service is deleted.
    Returns True on success, False when Cloudflare is not configured.
    """
    if not is_enabled():
        return False

    domain = settings.domain
    fqdn = f"{subdomain}.{domain}"

    async with httpx.AsyncClient(timeout=15) as client:
        await _delete_cname(client, fqdn)

        cfg = await _get_tunnel_config(client)
        cfg["ingress"] = [r for r in cfg["ingress"] if r.get("hostname") != fqdn]
        await _put_tunnel_config(client, cfg)

    return True


async def get_tunnel_status() -> dict[str, Any]:
    """Return tunnel connectivity info for the /api/infra/status endpoint."""
    if not is_enabled():
        return {"configured": False}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{_CF_BASE}/accounts/{settings.cloudflare_account_id}"
                f"/cfd_tunnel/{settings.cloudflare_tunnel_id}",
                headers=_headers(),
            )
            r.raise_for_status()
            tunnel = r.json().get("result", {})
            return {
                "configured": True,
                "tunnel_id": settings.cloudflare_tunnel_id,
                "status": tunnel.get("status", "unknown"),
                "name": tunnel.get("name", ""),
                "connections": len(tunnel.get("connections", [])),
            }
    except Exception as exc:
        return {"configured": True, "error": str(exc)}
