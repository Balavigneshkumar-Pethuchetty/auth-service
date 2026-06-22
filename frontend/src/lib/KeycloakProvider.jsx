import { createContext, useContext, useEffect, useState } from "react";
import { getKeycloak } from "./keycloak.js";

const KeycloakContext = createContext(null);

export function KeycloakProvider({ children }) {
  const [state, setState] = useState({
    keycloak: null,
    initialized: false,
    authenticated: false,
  });

  useEffect(() => {
    getKeycloak().then((kc) => {
      setState({ keycloak: kc, initialized: true, authenticated: !!kc.authenticated });

      // Re-render on auth state changes (e.g. silent SSO resolves).
      kc.onAuthSuccess = () => setState((s) => ({ ...s, authenticated: true }));
      kc.onAuthLogout = () => setState((s) => ({ ...s, authenticated: false }));
    });
  }, []);

  return (
    <KeycloakContext.Provider value={state}>
      {children}
    </KeycloakContext.Provider>
  );
}

export function useKeycloak() {
  const ctx = useContext(KeycloakContext);
  if (!ctx) throw new Error("useKeycloak must be used within KeycloakProvider");
  return ctx;
}
