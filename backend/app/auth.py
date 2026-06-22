"""
JWT authentication dependency for FastAPI.

Validates Bearer tokens issued by Keycloak using the cached JWKS.
If Keycloak is not reachable at startup (dev mode), all requests pass through
with an anonymous user so the app remains usable without auth infrastructure.
"""
import logging
from typing import Any, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from jose import JWTError, jwt
from jose.exceptions import ExpiredSignatureError

from . import keycloak_admin

log = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)

_DEV_USER = {"sub": "dev", "preferred_username": "dev", "email": "dev@local", "name": "Dev User"}


def _find_key(kid: str) -> Optional[dict]:
    for k in keycloak_admin.get_cached_jwks():
        if k.get("kid") == kid:
            return k
    return None


async def _validate(token: str) -> dict[str, Any]:
    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token header: {exc}")

    kid = header.get("kid", "")
    key = _find_key(kid)

    if key is None:
        # Attempt a one-time JWKS refresh (new keys may have been rotated).
        try:
            await keycloak_admin.refresh_jwks()
        except Exception:
            pass
        key = _find_key(kid)

    if key is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown signing key.")

    try:
        payload = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            # Signature is verified above — skip issuer/audience to allow internal
            # vs external Keycloak hostname differences (keycloak:8080 vs localhost:8080).
            options={"verify_aud": False, "verify_iss": False},
        )
        return payload
    except ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token has expired.")
    except JWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Token validation failed: {exc}")


async def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict[str, Any]:
    """
    FastAPI dependency — returns the decoded token payload.

    Dev-mode bypass: if no JWKS are cached (Keycloak not yet set up),
    any request is accepted and a synthetic dev-user is returned.
    """
    if not keycloak_admin.get_cached_jwks():
        # Keycloak not yet initialised — allow all requests in dev mode.
        return _DEV_USER

    if not creds:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Bearer token required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return await _validate(creds.credentials)
