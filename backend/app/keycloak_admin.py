"""
Keycloak Admin REST API client.

On startup, ensures the 'standalone' realm and 'sss-frontend' public client
exist, then caches the realm's JWKS for JWT validation.
"""
import asyncio
import logging
from typing import Any

import httpx

from .config import settings

log = logging.getLogger(__name__)

# Module-level cache populated by setup().
_jwks: list[dict] = []
_issuer: str = ""


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _base() -> str:
    return settings.keycloak_url.rstrip("/")


async def _admin_token(client: httpx.AsyncClient) -> str:
    r = await client.post(
        f"{_base()}/realms/master/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": settings.keycloak_admin_user,
            "password": settings.keycloak_admin_password,
        },
    )
    r.raise_for_status()
    return r.json()["access_token"]


async def _ensure_realm(client: httpx.AsyncClient, token: str) -> None:
    realm = settings.keycloak_realm
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.get(f"{_base()}/admin/realms/{realm}", headers=headers)
    if r.status_code == 200:
        log.info("Keycloak realm '%s' already exists.", realm)
        return
    payload: dict[str, Any] = {
        "realm": realm,
        "enabled": True,
        "displayName": "Standalone Services",
        "accessTokenLifespan": 3600,
        "ssoSessionMaxLifespan": 86400,
        "registrationAllowed": False,
    }
    r = await client.post(f"{_base()}/admin/realms", json=payload, headers=headers)
    r.raise_for_status()
    log.info("Keycloak realm '%s' created.", realm)


async def _ensure_default_user(client: httpx.AsyncClient, token: str) -> None:
    """Create a default 'admin' user in the realm if none exists yet."""
    realm = settings.keycloak_realm
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.get(f"{_base()}/admin/realms/{realm}/users", headers=headers)
    r.raise_for_status()
    if r.json():
        return  # at least one user already exists
    payload = {
        "username": settings.keycloak_admin_user,
        "email": f"{settings.keycloak_admin_user}@{settings.domain}",
        "firstName": "Admin",
        "lastName": "User",
        "enabled": True,
        "credentials": [
            {"type": "password", "value": settings.keycloak_admin_password, "temporary": False}
        ],
    }
    r = await client.post(
        f"{_base()}/admin/realms/{realm}/users",
        json=payload,
        headers=headers,
    )
    r.raise_for_status()
    log.info(
        "Keycloak: default user '%s' created in realm '%s'.",
        settings.keycloak_admin_user,
        realm,
    )


async def _ensure_client(client: httpx.AsyncClient, token: str, redirect_origins: list[str]) -> None:
    realm = settings.keycloak_realm
    client_id = settings.keycloak_client_id
    headers = {"Authorization": f"Bearer {token}"}

    r = await client.get(
        f"{_base()}/admin/realms/{realm}/clients",
        params={"clientId": client_id},
        headers=headers,
    )
    r.raise_for_status()
    existing = r.json()
    if existing:
        log.info("Keycloak client '%s' already exists.", client_id)
        # Refresh redirect URIs in case domain changed.
        kc_id = existing[0]["id"]
        await client.put(
            f"{_base()}/admin/realms/{realm}/clients/{kc_id}",
            json={
                **existing[0],
                "redirectUris": redirect_origins + ["*"],
                "webOrigins": redirect_origins + ["*"],
            },
            headers=headers,
        )
        return

    payload: dict[str, Any] = {
        "clientId": client_id,
        "enabled": True,
        "publicClient": True,
        "standardFlowEnabled": True,
        "implicitFlowEnabled": False,
        "directAccessGrantsEnabled": True,  # allows curl/API testing; browser still uses PKCE
        "redirectUris": redirect_origins + ["*"],
        "webOrigins": redirect_origins + ["*"],
        "attributes": {"pkce.code.challenge.method": "S256"},
    }
    r = await client.post(
        f"{_base()}/admin/realms/{realm}/clients",
        json=payload,
        headers=headers,
    )
    r.raise_for_status()
    log.info("Keycloak client '%s' created.", client_id)


async def _fetch_jwks(client: httpx.AsyncClient) -> list[dict]:
    realm = settings.keycloak_realm
    r = await client.get(
        f"{_base()}/realms/{realm}/protocol/openid-connect/certs"
    )
    r.raise_for_status()
    return r.json().get("keys", [])


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def wait_for_keycloak(timeout: float = 120.0) -> None:
    """Block until Keycloak's health endpoint responds."""
    url = f"{_base()}/health/ready"
    deadline = asyncio.get_event_loop().time() + timeout
    async with httpx.AsyncClient(timeout=5) as client:
        while asyncio.get_event_loop().time() < deadline:
            try:
                r = await client.get(url)
                if r.status_code < 500:
                    log.info("Keycloak is ready.")
                    return
            except Exception:
                pass
            await asyncio.sleep(3)
    raise TimeoutError("Keycloak did not become ready in time.")


async def setup() -> None:
    """
    Ensure realm + client exist, then cache JWKS.
    Called once at application startup (after Keycloak is ready).
    """
    global _jwks, _issuer
    redirect_origins = [
        "http://localhost:5173",
        f"https://{settings.domain}",
        f"https://www.{settings.domain}",
    ]
    async with httpx.AsyncClient(timeout=10) as client:
        token = await _admin_token(client)
        await _ensure_realm(client, token)
        # Re-fetch token (realm creation may invalidate it).
        token = await _admin_token(client)
        await _ensure_client(client, token, redirect_origins)
        await _ensure_default_user(client, token)
        _jwks = await _fetch_jwks(client)
        _issuer = f"{_base()}/realms/{settings.keycloak_realm}"
    log.info("Keycloak setup complete. JWKS cached (%d keys).", len(_jwks))


async def refresh_jwks() -> None:
    """Re-fetch JWKS (called when a JWT kid is unknown)."""
    global _jwks
    async with httpx.AsyncClient(timeout=10) as client:
        _jwks = await _fetch_jwks(client)


def get_cached_jwks() -> list[dict]:
    return _jwks


def get_issuer() -> str:
    return _issuer


def is_configured() -> bool:
    return bool(settings.keycloak_url)


async def export_realm() -> dict:
    """Return the full realm JSON from the live Keycloak admin API."""
    async with httpx.AsyncClient(timeout=15) as client:
        token = await _admin_token(client)
        r = await client.get(
            f"{_base()}/admin/realms/{settings.keycloak_realm}",
            headers={"Authorization": f"Bearer {token}"},
        )
        r.raise_for_status()
        return r.json()
