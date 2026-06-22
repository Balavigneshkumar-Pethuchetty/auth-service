import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useServices } from "../lib/services.jsx";
import { deleteService } from "../lib/api.js";
import StatusPill from "../components/StatusPill.jsx";

export default function Detail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { services, setServices } = useServices();

  const svc = useMemo(() => services.find((s) => s.id === id), [services, id]);

  if (!svc) {
    return (
      <div className="mx-auto max-w-3xl">
        <button onClick={() => navigate("/dashboard")} className="mb-4 text-sm text-slate-400 hover:text-slate-200">
          ← All services
        </button>
        <div className="rounded-xl border border-line bg-ink-800 p-8 text-center text-slate-400">
          Service not found — it may have been deleted.
        </div>
      </div>
    );
  }

  const remove = async () => {
    try {
      await deleteService(svc.id);
      setServices((prev) => prev.filter((s) => s.id !== svc.id));
      navigate("/dashboard");
    } catch (err) {
      alert(err?.response?.data?.detail || "Could not delete service");
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <button onClick={() => navigate("/dashboard")} className="mb-4 flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        All services
      </button>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{svc.name}</h1>
            <StatusPill status={svc.status} />
          </div>
          <div className="mt-2 font-mono text-[13px] text-accent">https://{svc.route}</div>
        </div>
        <button
          onClick={remove}
          className="flex h-9 items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 text-[13px] font-semibold text-rose-400 hover:brightness-110"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
          </svg>
          Delete
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-ink-800 p-4">
          <div className="mb-3 text-[13px] font-semibold">Overview</div>
          <Row label="Type" value={svc.type} mono />
          <Row label="Port" value={String(svc.port)} mono />
          <Row label="Service ID" value={svc.id} mono muted />
          <Row label="Subdomain" value={svc.subdomain} mono />
          <Row label="Status" value={svc.status} mono />
        </div>
        <div className="rounded-xl border border-line bg-ink-800 p-4">
          <div className="mb-3 text-[13px] font-semibold">Endpoints</div>
          <Endpoint method="GET" color="text-emerald-400" path={"/api/config/status/" + svc.id} />
          <Endpoint method="POST" color="text-accent" path="/api/config/setup" />
          <Endpoint method="DEL" color="text-rose-400" path={"/api/config/delete/" + svc.id} />
        </div>
      </div>

      <div className="mt-3.5 rounded-xl border border-line bg-ink-800 p-4">
        <div className="mb-2.5 text-[13px] font-semibold">Configuration</div>
        <pre className="overflow-auto rounded-lg border border-line bg-ink-700 p-4 font-mono text-xs leading-relaxed text-slate-300">
          {JSON.stringify(svc.config, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function Row({ label, value, mono, muted }) {
  return (
    <div className="flex items-center justify-between border-b border-line/60 py-2 text-[13px] last:border-0">
      <span className="text-slate-400">{label}</span>
      <span className={(mono ? "font-mono " : "") + (muted ? "text-slate-500" : "")}>{value}</span>
    </div>
  );
}

function Endpoint({ method, color, path }) {
  return (
    <div className="flex items-center gap-3 py-1.5 font-mono text-xs">
      <span className={"w-10 font-semibold " + color}>{method}</span>
      <span className="text-slate-400">{path}</span>
    </div>
  );
}
