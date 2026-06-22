import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useServices } from "../lib/services.jsx";
import { useKeycloak } from "../lib/KeycloakProvider.jsx";

const NAV = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/upload", label: "Upload Config" },
  { to: "/tunnel", label: "Tunnel Routes" },
  { to: "/settings", label: "Settings" },
];

export default function Layout() {
  const navigate = useNavigate();
  const { live } = useServices();
  const { keycloak } = useKeycloak();

  const token = keycloak?.tokenParsed;
  const displayName = token?.name || token?.preferred_username || "Admin";
  const displayEmail = token?.email || "admin@local";
  const initials = displayName
    .split(" ")
    .map((w) => w[0]?.toUpperCase() || "")
    .slice(0, 2)
    .join("");

  const logout = () => {
    if (keycloak?.authenticated) {
      keycloak.logout({ redirectUri: window.location.origin + "/login" });
    } else {
      navigate("/login");
    }
  };

  return (
    <div className="grid min-h-screen grid-cols-[236px_1fr]">
      {/* Sidebar */}
      <aside className="sticky top-0 flex h-screen flex-col border-r border-line bg-ink-800">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-mono text-sm font-semibold text-ink-900">
            S
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold">Standalone</div>
            <div className="text-[11px] text-slate-500">Services Suite</div>
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 p-2.5">
          <div className="px-2.5 py-2 text-[10px] font-semibold tracking-wider text-slate-500">MANAGE</div>
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                "rounded-lg px-3 py-2 text-[13px] font-medium transition-colors " +
                (isActive ? "bg-accent/15 text-accent" : "text-slate-400 hover:bg-ink-700")
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t border-line p-3.5">
          <div className="flex items-center gap-2.5 rounded-xl border border-line bg-ink-700 px-3 py-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 font-mono text-xs font-semibold text-accent">
              {initials || "??"}
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-xs font-semibold">{displayName}</div>
              <div className="truncate text-[11px] text-slate-500">{displayEmail}</div>
            </div>
            <button onClick={logout} title="Sign out" className="text-slate-500 hover:text-rose-400">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                <path d="M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-10 flex h-[60px] items-center gap-3 border-b border-line bg-ink-800 px-6">
          <div className="flex-1" />
          {/* Keycloak auth indicator */}
          <div className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-slate-500">
            <span className={"h-2 w-2 rounded-full " + (keycloak?.authenticated ? "bg-emerald-400" : "bg-amber-400")} />
            {keycloak?.authenticated ? "Keycloak" : "Auth pending"}
          </div>
          {/* WebSocket live indicator */}
          <div
            className={
              "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium " +
              (live ? "border-emerald-500/30 text-emerald-400" : "border-line text-slate-500")
            }
          >
            <span className={"h-2 w-2 rounded-full " + (live ? "animate-pulse bg-emerald-400" : "bg-slate-500")} />
            {live ? "Realtime connected" : "Connecting…"}
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
