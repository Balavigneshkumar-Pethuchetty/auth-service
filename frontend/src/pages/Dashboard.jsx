import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useServices } from "../lib/services.jsx";
import { deleteService } from "../lib/api.js";
import StatusPill from "../components/StatusPill.jsx";

export default function Dashboard() {
  const navigate = useNavigate();
  const { services, setServices } = useServices();
  const [view, setView] = useState("cards");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return services;
    return services.filter(
      (s) =>
        s.name.toLowerCase().includes(t) ||
        s.type.toLowerCase().includes(t) ||
        (s.route || "").toLowerCase().includes(t)
    );
  }, [services, q]);

  const stats = useMemo(() => {
    const active = services.filter((s) => s.status === "active").length;
    const warn = services.filter((s) => s.status === "degraded" || s.status === "provisioning").length;
    return { total: services.length, active, warn };
  }, [services]);

  const remove = async (e, id) => {
    e.stopPropagation();
    try {
      await deleteService(id);
      setServices((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      alert(err?.response?.data?.detail || "Could not delete service");
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xl font-semibold tracking-tight">Services</div>
          <div className="mt-0.5 text-[13px] text-slate-400">
            {services.length} services registered · updates stream live
          </div>
        </div>
        <button
          onClick={() => navigate("/upload")}
          className="flex h-[38px] items-center gap-1.5 rounded-lg bg-accent px-4 text-[13px] font-semibold text-ink-900 hover:brightness-110"
        >
          + New service
        </button>
      </div>

      {/* stats */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="TOTAL SERVICES" value={stats.total} />
        <Stat label="ACTIVE" value={stats.active} valueClass="text-emerald-400" />
        <Stat label="NEEDS ATTENTION" value={stats.warn} valueClass="text-amber-400" />
        <Stat label="SSL / TUNNEL" value="OK" valueClass="text-emerald-400" />
      </div>

      {/* toolbar */}
      <div className="mb-3.5 flex items-center gap-2.5">
        <div className="flex h-9 max-w-sm flex-1 items-center gap-2 rounded-lg border border-line bg-ink-800 px-3">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8b94a3" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter services…"
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-slate-500"
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-line bg-ink-800 p-1">
          <ViewBtn active={view === "cards"} onClick={() => setView("cards")} label="Cards" />
          <ViewBtn active={view === "table"} onClick={() => setView("table")} label="Table" />
        </div>
      </div>

      {/* list */}
      {view === "cards" ? (
        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => (
            <div
              key={s.id}
              onClick={() => navigate("/services/" + s.id)}
              className="cursor-pointer rounded-xl border border-line bg-ink-800 p-4 transition hover:-translate-y-0.5 hover:border-slate-600"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={dot(s.status)} />
                  <div className="truncate text-sm font-semibold">{s.name}</div>
                </div>
                <span className="shrink-0 rounded-md border border-line bg-ink-700 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                  {s.type}
                </span>
              </div>
              <div className="my-3 truncate font-mono text-[11px] text-slate-500">{s.route}</div>
              <div className="flex items-center justify-between">
                <StatusPill status={s.status} />
                <button
                  onClick={(e) => remove(e, s.id)}
                  className="rounded-md p-1.5 text-slate-500 hover:bg-rose-400/10 hover:text-rose-400"
                  title="Delete"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-ink-800">
          <div className="grid grid-cols-[2fr_2.4fr_1fr_1fr_44px] gap-3 border-b border-line bg-ink-700 px-4 py-2.5 text-[11px] font-semibold tracking-wide text-slate-500">
            <div>NAME</div>
            <div>ROUTE</div>
            <div>TYPE</div>
            <div>STATUS</div>
            <div />
          </div>
          {filtered.map((s) => (
            <div
              key={s.id}
              onClick={() => navigate("/services/" + s.id)}
              className="grid cursor-pointer grid-cols-[2fr_2.4fr_1fr_1fr_44px] items-center gap-3 border-b border-line px-4 py-3 text-[13px] hover:bg-ink-700"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className={dot(s.status)} />
                <span className="truncate font-semibold">{s.name}</span>
              </div>
              <div className="truncate font-mono text-xs text-slate-400">{s.route}</div>
              <div className="text-xs text-slate-400">{s.type}</div>
              <div>
                <StatusPill status={s.status} />
              </div>
              <button
                onClick={(e) => remove(e, s.id)}
                className="justify-self-end rounded-md p-1.5 text-slate-500 hover:bg-rose-400/10 hover:text-rose-400"
                title="Delete"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, valueClass = "" }) {
  return (
    <div className="rounded-xl border border-line bg-ink-800 px-4 py-3.5">
      <div className="text-[11px] font-medium tracking-wide text-slate-500">{label}</div>
      <div className={"mt-1 text-2xl font-semibold tracking-tight " + valueClass}>{value}</div>
    </div>
  );
}

function ViewBtn({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-md px-3 py-1 text-xs font-medium " +
        (active ? "bg-accent text-ink-900" : "text-slate-400 hover:text-slate-200")
      }
    >
      {label}
    </button>
  );
}

function dot(status) {
  const c =
    status === "active"
      ? "bg-emerald-400"
      : status === "stopped"
      ? "bg-rose-400"
      : "bg-amber-400";
  return "h-2.5 w-2.5 shrink-0 rounded-full " + c;
}
