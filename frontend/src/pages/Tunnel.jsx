import { useEffect, useState } from "react";
import { getTunnelRoutes, addTunnelRoute, updateTunnelRoute, deleteTunnelRoute } from "../lib/api.js";

export default function Tunnel() {
  const [routes, setRoutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");

  const [hostname, setHostname] = useState("");
  const [service, setService] = useState("");
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState(null); // { type: "ok"|"err"|"warn", text }

  const [editHost, setEditHost] = useState(null);   // hostname being edited
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const [confirmHost, setConfirmHost] = useState(null);
  const [deletingHost, setDeletingHost] = useState(null);

  useEffect(() => {
    getTunnelRoutes()
      .then((d) => setRoutes(d.routes))
      .catch((e) => setFetchError(e?.response?.data?.detail || "Failed to load routes"))
      .finally(() => setLoading(false));
  }, []);

  const showMsg = (type, text) => setMsg({ type, text });
  const clearMsg = () => setMsg(null);

  const handleAdd = async () => {
    if (!hostname.trim() || !service.trim()) return;
    setAdding(true);
    clearMsg();
    try {
      const d = await addTunnelRoute({ hostname: hostname.trim(), service: service.trim() });
      setRoutes(d.routes);
      setHostname("");
      setService("");
      d.restart_error
        ? showMsg("warn", `Route saved but restart failed: ${d.restart_error}`)
        : showMsg("ok", "Route added — cloudflared restarting (~5 s).");
    } catch (e) {
      showMsg("err", e?.response?.data?.detail || "Failed to add route");
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (r) => {
    setEditHost(r.hostname);
    setEditValue(r.service);
    setConfirmHost(null);
    clearMsg();
  };

  const cancelEdit = () => { setEditHost(null); setEditValue(""); };

  const handleSave = async (originalHostname) => {
    if (!editValue.trim()) return;
    setSaving(true);
    clearMsg();
    try {
      const d = await updateTunnelRoute(originalHostname, { service: editValue.trim() });
      setRoutes(d.routes);
      cancelEdit();
      d.restart_error
        ? showMsg("warn", `Saved but restart failed: ${d.restart_error}`)
        : showMsg("ok", "Route updated — cloudflared restarting (~5 s).");
    } catch (e) {
      showMsg("err", e?.response?.data?.detail || "Failed to update route");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (host) => {
    if (confirmHost !== host) { setConfirmHost(host); return; }
    setConfirmHost(null);
    setDeletingHost(host);
    clearMsg();
    try {
      const d = await deleteTunnelRoute(host);
      setRoutes(d.routes);
      d.restart_error
        ? showMsg("warn", `Removed but restart failed: ${d.restart_error}`)
        : showMsg("ok", `'${host}' removed — cloudflared restarting (~5 s).`);
    } catch (e) {
      showMsg("err", e?.response?.data?.detail || "Failed to delete route");
    } finally {
      setDeletingHost(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="text-xl font-semibold tracking-tight">Tunnel Routes</div>
      <div className="mb-6 mt-0.5 text-[13px] text-slate-400">
        Manage cloudflare tunnel ingress rules. Changes are written to{" "}
        <span className="font-mono text-slate-300">config.yml</span> and cloudflared restarts automatically.
      </div>

      {/* Add route form */}
      <div className="mb-4 rounded-xl border border-line bg-ink-800 p-5">
        <div className="mb-4 text-sm font-semibold">Add Route</div>
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="mb-1 block text-[11px] text-slate-500">Hostname</label>
            <input
              value={hostname}
              onChange={(e) => { setHostname(e.target.value); clearMsg(); }}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder="app.gm-global-techies-town.club"
              className="h-9 w-full rounded-lg border border-line bg-ink-700 px-3 font-mono text-[13px] outline-none focus:border-accent"
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-[11px] text-slate-500">Service URL</label>
            <input
              value={service}
              onChange={(e) => { setService(e.target.value); clearMsg(); }}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              placeholder="http://host.containers.internal:3000"
              className="h-9 w-full rounded-lg border border-line bg-ink-700 px-3 font-mono text-[13px] outline-none focus:border-accent"
            />
          </div>
          <div className="flex flex-col justify-end">
            <button
              onClick={handleAdd}
              disabled={adding || !hostname.trim() || !service.trim()}
              className={
                "h-9 rounded-lg px-4 text-[13px] font-semibold " +
                (!adding && hostname.trim() && service.trim()
                  ? "bg-accent text-ink-900 hover:brightness-110"
                  : "cursor-not-allowed border border-line bg-ink-700 text-slate-500")
              }
            >
              {adding ? "Adding…" : "Add"}
            </button>
          </div>
        </div>

        {msg && (
          <div className={
            "mt-3 rounded-lg px-3 py-2 text-xs " +
            (msg.type === "ok" ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : msg.type === "warn" ? "border border-amber-500/30 bg-amber-500/10 text-amber-300"
              : "border border-rose-500/30 bg-rose-500/10 text-rose-300")
          }>
            {msg.text}
          </div>
        )}
      </div>

      {/* Routes table */}
      <div className="rounded-xl border border-line bg-ink-800">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-sm font-semibold">Active Routes</div>
          <div className="text-xs text-slate-500">{routes.length} rule{routes.length !== 1 ? "s" : ""}</div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Loading…
          </div>
        ) : fetchError ? (
          <div className="px-5 py-6 text-sm text-rose-400">{fetchError}</div>
        ) : routes.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">No named routes yet.</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-5 py-2.5 w-2/5">Hostname</th>
                <th className="px-5 py-2.5">Service URL</th>
                <th className="px-5 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.hostname} className="border-b border-line/60 last:border-0 hover:bg-ink-700/30">
                  <td className="px-5 py-3 font-mono text-slate-200 align-top pt-3.5">{r.hostname}</td>
                  <td className="px-5 py-2">
                    {editHost === r.hostname ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSave(r.hostname);
                            if (e.key === "Escape") cancelEdit();
                          }}
                          className="h-8 flex-1 rounded-lg border border-accent/50 bg-ink-700 px-2.5 font-mono text-[13px] outline-none focus:border-accent"
                        />
                        <button
                          onClick={() => handleSave(r.hostname)}
                          disabled={saving || !editValue.trim()}
                          className="h-8 rounded-lg bg-accent px-3 text-xs font-semibold text-ink-900 hover:brightness-110 disabled:opacity-40"
                        >
                          {saving ? "…" : "Save"}
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="h-8 rounded-lg border border-line px-3 text-xs text-slate-400 hover:text-slate-200"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <span className="font-mono text-slate-400">{r.service}</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {deletingHost === r.hostname ? (
                      <span className="text-xs text-slate-500">Removing…</span>
                    ) : confirmHost === r.hostname ? (
                      <span className="flex items-center justify-end gap-2">
                        <span className="text-xs text-slate-400">Confirm?</span>
                        <button
                          onClick={() => handleDelete(r.hostname)}
                          className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-400 hover:bg-rose-500/20"
                        >
                          Yes, delete
                        </button>
                        <button
                          onClick={() => setConfirmHost(null)}
                          className="rounded-md border border-line px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span className="flex items-center justify-end gap-1.5">
                        {editHost !== r.hostname && (
                          <button
                            onClick={() => startEdit(r)}
                            className="rounded-md border border-line px-2.5 py-1 text-xs text-slate-400 hover:border-accent/40 hover:text-accent"
                          >
                            Edit
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(r.hostname)}
                          className="rounded-md border border-line px-2.5 py-1 text-xs text-slate-400 hover:border-rose-500/40 hover:text-rose-400"
                        >
                          Delete
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="border-t border-line px-5 py-3 text-[11px] text-slate-500">
          Catch-all rule (<span className="font-mono">http_status:404</span>) is always preserved and not shown here.
        </div>
      </div>
    </div>
  );
}
