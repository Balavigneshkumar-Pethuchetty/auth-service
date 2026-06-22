import Keycloak from "keycloak-js";
import { API_URL } from "./api.js";

let _keycloak = null;
let _initPromise = null;

/**
 * Lazily create + initialise the Keycloak adapter.
 *
 * Config is fetched from the backend (/api/auth/keycloak-config) so the
 * frontend never needs to hardcode URLs — they flow from environment variables
 * set on the backend container.
 */
async function _fetchConfig() {
  try {
    const r = await fetch(`${API_URL}/api/auth/keycloak-config`);
    if (!r.ok) throw new Error("backend unavailable");
    return await r.json();
  } catch {
    // Fall back to env vars / defaults if backend not reachable yet.
    return {
      url: import.meta.env.VITE_KEYCLOAK_URL || "http://localhost:8180",
      realm: import.meta.env.VITE_KEYCLOAK_REALM || "standalone",
      clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID || "sss-frontend",
    };
  }
}

export async function getKeycloak() {
  if (_keycloak) return _keycloak;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const cfg = await _fetchConfig();
    _keycloak = new Keycloak(cfg);

    await _keycloak.init({
      onLoad: "check-sso",
      silentCheckSsoRedirectUri: window.location.origin + "/silent-check-sso.html",
      pkceMethod: "S256",
      checkLoginIframe: false,
    });

    // Proactively refresh the token when it's about to expire.
    _keycloak.onTokenExpired = () => {
      _keycloak.updateToken(60).catch(() => {});
    };

    setInterval(() => {
      if (_keycloak.authenticated) {
        _keycloak.updateToken(70).catch(() => {});
      }
    }, 60_000);

    return _keycloak;
  })();

  return _initPromise;
}
