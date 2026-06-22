import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useKeycloak } from "../lib/KeycloakProvider.jsx";

export default function Login() {
  const navigate = useNavigate();
  const { initialized, authenticated, keycloak } = useKeycloak();

  // If already authenticated, skip the login page.
  useEffect(() => {
    if (initialized && authenticated) {
      navigate("/dashboard", { replace: true });
    }
  }, [initialized, authenticated, navigate]);

  const signIn = () => {
    if (keycloak) {
      keycloak.login({ redirectUri: window.location.origin + "/dashboard" });
    }
  };

  const isLoading = !initialized;

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex items-center justify-center p-12">
        <div className="w-full max-w-sm">
          <div className="mb-9 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent font-mono text-base font-semibold text-ink-900">
              S
            </div>
            <div className="text-[15px] font-semibold">Standalone Services Suite</div>
          </div>
          <h1 className="mb-1.5 text-[26px] font-semibold tracking-tight">Sign in to the portal</h1>
          <p className="mb-8 text-sm text-slate-400">
            Manage Keycloak &amp; Cloudflared services for your domain.
          </p>

          <button
            onClick={signIn}
            disabled={isLoading}
            className="flex h-11 w-full items-center justify-center gap-2.5 rounded-lg bg-accent text-sm font-semibold text-ink-900 hover:brightness-110 disabled:opacity-60"
          >
            {isLoading ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Connecting to Keycloak…
              </>
            ) : (
              "Sign in with Keycloak"
            )}
          </button>

          <div className="my-5 flex items-center gap-3 text-xs text-slate-500">
            <div className="h-px flex-1 bg-line" />
            SECURED BY KEYCLOAK
            <div className="h-px flex-1 bg-line" />
          </div>
          <p className="text-center text-xs text-slate-500">
            SSO realm: <span className="font-mono text-slate-400">standalone</span>
          </p>
        </div>
      </div>

      {/* Right panel — live services preview */}
      <div className="relative hidden items-center justify-center overflow-hidden border-l border-line bg-ink-800 p-12 lg:flex">
        <div
          className="absolute inset-0"
          style={{ backgroundImage: "radial-gradient(circle at 75% 20%, rgba(93,134,255,.15), transparent 55%)" }}
        />
        <div className="relative w-full max-w-sm">
          <div className="mb-3.5 font-mono text-[11px] tracking-wide text-slate-500">// LIVE INFRASTRUCTURE</div>
          <div className="flex flex-col gap-2.5">
            {[
              ["keycloak-auth", "auth", "emerald", "Auth · SSO · JWKS"],
              ["cloudflared-edge", "tunnel", "emerald", "DNS · Tunnel Ingress"],
              ["event-management", "events", "emerald", "Protected Service"],
            ].map(([name, sub, color, desc]) => (
              <div key={name} className="flex items-center gap-3 rounded-xl border border-line bg-ink-700 px-4 py-3.5">
                <span className={"h-2.5 w-2.5 rounded-full " + (color === "amber" ? "bg-amber-400" : "bg-emerald-400")} />
                <div className="flex-1">
                  <div className="text-[13px] font-semibold">{name}</div>
                  <div className="font-mono text-[11px] text-slate-500">{sub}.gm-global-techies-town.club</div>
                  <div className="mt-0.5 text-[10px] text-slate-600">{desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-[11px] text-emerald-400">
            Keycloak realm <span className="font-mono">standalone</span> auto-provisioned on first boot.
          </div>
        </div>
      </div>
    </div>
  );
}
