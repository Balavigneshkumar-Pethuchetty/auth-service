import { useEffect, useMemo, useState, useCallback, Fragment } from "react";
import {
  listSmsGateways,
  createSmsGateway,
  updateSmsGateway,
  deleteSmsGateway,
  pingSmsGateway,
  getOtpHistory,
} from "../lib/api.js";

const GATEWAY_STATUS = {
  online: "text-emerald-400 bg-emerald-400/10",
  unreachable: "text-rose-400 bg-rose-400/10",
  unknown: "text-slate-400 bg-slate-400/10",
};

const OTP_STATUS = {
  verified: "text-emerald-400 bg-emerald-400/10",
  pending: "text-amber-400 bg-amber-400/10",
  expired: "text-slate-400 bg-slate-400/10",
  locked: "text-rose-400 bg-rose-400/10",
  send_failed: "text-rose-400 bg-rose-400/10",
};

function Pill({ text, cls }) {
  return (
    <span className={"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold " + (cls || GATEWAY_STATUS.unknown)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {text}
    </span>
  );
}

function timeAgo(iso) {
  if (!iso) return "never";
  const diff = (Date.now() - new Date(iso + "Z").getTime()) / 1000;
  if (diff < 60) return Math.floor(diff) + "s ago";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

function Stat({ label, value, valueClass = "" }) {
  return (
    <div className="rounded-xl border border-line bg-ink-800 px-4 py-3.5">
      <div className="text-[11px] font-medium tracking-wide text-slate-500">{label}</div>
      <div className={"mt-1 text-2xl font-semibold tracking-tight " + valueClass}>{value}</div>
    </div>
  );
}

const emptyForm = { label: "", username: "", password: "", device_id: "", priority: 100 };

export default function Monitor() {
  const [gateways, setGateways] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pinging, setPinging] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    try {
      const [gw, hist] = await Promise.all([listSmsGateways(), getOtpHistory()]);
      setGateways(gw);
      setHistory(hist);
    } catch (e) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "Failed to load monitoring data" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000); // live-ish without a dedicated websocket channel
    return () => clearInterval(t);
  }, [load]);

  const stats = useMemo(() => {
    const online = gateways.filter((g) => g.last_status === "online").length;
    const enabled = gateways.filter((g) => g.enabled).length;
    const otpSent24h = history.filter((h) => Date.now() - new Date(h.created_at + "Z").getTime() < 86400000).length;
    const verified24h = history.filter(
      (h) => h.status === "verified" && Date.now() - new Date(h.created_at + "Z").getTime() < 86400000
    ).length;
    return { online, enabled, total: gateways.length, otpSent24h, verified24h };
  }, [gateways, history]);

  const ping = async (id) => {
    setPinging(id);
    try {
      const r = await pingSmsGateway(id);
      setMsg(r.reachable ? { type: "ok", text: "Gateway reachable" } : { type: "err", text: r.error || "Unreachable" });
      await load();
    } finally {
      setPinging(null);
    }
  };

  const toggleEnabled = async (gw) => {
    await updateSmsGateway(gw.id, { enabled: !gw.enabled });
    await load();
  };

  const remove = async (id) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setConfirmDelete(null);
    await deleteSmsGateway(id);
    await load();
  };

  const submitAdd = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await createSmsGateway({ ...form, priority: Number(form.priority) });
      setForm(emptyForm);
      setShowAdd(false);
      setMsg({ type: "ok", text: "Gateway added" });
      await load();
    } catch (e) {
      setMsg({ type: "err", text: e?.response?.data?.detail || "Failed to add gateway" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xl font-semibold tracking-tight">OTP &amp; SMS Monitor</div>
          <div className="mt-0.5 text-[13px] text-slate-400">
            Committee-phone SMS gateways and OTP delivery history · refreshes every 15s
          </div>
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="flex h-[38px] items-center gap-1.5 rounded-lg bg-accent px-4 text-[13px] font-semibold text-ink-900 hover:brightness-110"
        >
          + Add gateway phone
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="GATEWAYS ONLINE" value={`${stats.online}/${stats.total}`} valueClass={stats.online > 0 ? "text-emerald-400" : "text-rose-400"} />
        <Stat label="ENABLED" value={stats.enabled} />
        <Stat label="OTPs SENT (24H)" value={stats.otpSent24h} />
        <Stat label="VERIFIED (24H)" value={stats.verified24h} valueClass="text-emerald-400" />
        <Stat label="HISTORY ROWS" value={history.length} />
      </div>

      {msg && (
        <div
          className={
            "mb-4 rounded-lg px-3 py-2 text-xs " +
            (msg.type === "ok"
              ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border border-rose-500/30 bg-rose-500/10 text-rose-300")
          }
        >
          {msg.text}
        </div>
      )}

      {showAdd && (
        <form onSubmit={submitAdd} className="mb-4 rounded-xl border border-line bg-ink-800 p-5">
          <div className="mb-4 text-sm font-semibold">Add SMS Gateway Phone</div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label="Label" value={form.label} onChange={(v) => setForm((f) => ({ ...f, label: v }))} placeholder="Bala primary" required />
            <Field label="Username" value={form.username} onChange={(v) => setForm((f) => ({ ...f, username: v }))} placeholder="from the app's Cloud Server section" required />
            <Field label="Password" value={form.password} onChange={(v) => setForm((f) => ({ ...f, password: v }))} placeholder="from the app's Cloud Server section" type="password" required />
            <Field label="Device ID" value={form.device_id} onChange={(v) => setForm((f) => ({ ...f, device_id: v }))} placeholder="from the app's Cloud Server section" required />
            <Field label="Priority (lower = tried first)" value={form.priority} onChange={(v) => setForm((f) => ({ ...f, priority: v }))} placeholder="100" />
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-ink-900 hover:brightness-110 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save gateway"}
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="h-9 rounded-lg border border-line px-4 text-[13px] text-slate-400 hover:text-slate-200"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Gateways table */}
      <div className="mb-6 rounded-xl border border-line bg-ink-800">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-sm font-semibold">SMS Gateway Phones</div>
          <div className="text-xs text-slate-500">{gateways.length} configured, tried in priority order</div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Loading…
          </div>
        ) : gateways.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">No gateway phones configured yet.</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-5 py-2.5">Label</th>
                <th className="px-5 py-2.5">Username</th>
                <th className="px-5 py-2.5">Priority</th>
                <th className="px-5 py-2.5">Status</th>
                <th className="px-5 py-2.5">Last checked</th>
                <th className="px-5 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {[...gateways]
                .sort((a, b) => a.priority - b.priority)
                .map((g) => (
                  <tr key={g.id} className="border-b border-line/60 last:border-0 hover:bg-ink-700/30">
                    <td className="px-5 py-3 font-semibold text-slate-200">{g.label}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-400">{g.username}</td>
                    <td className="px-5 py-3 text-slate-400">{g.priority}</td>
                    <td className="px-5 py-3">
                      <Pill text={g.enabled ? g.last_status : "disabled"} cls={g.enabled ? GATEWAY_STATUS[g.last_status] : GATEWAY_STATUS.unknown} />
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">{timeAgo(g.last_checked_at)}</td>
                    <td className="px-5 py-3 text-right">
                      <span className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => ping(g.id)}
                          disabled={pinging === g.id}
                          className="rounded-md border border-line px-2.5 py-1 text-xs text-slate-400 hover:border-accent/40 hover:text-accent disabled:opacity-40"
                        >
                          {pinging === g.id ? "Pinging…" : "Ping"}
                        </button>
                        <button
                          onClick={() => toggleEnabled(g)}
                          className="rounded-md border border-line px-2.5 py-1 text-xs text-slate-400 hover:border-accent/40 hover:text-accent"
                        >
                          {g.enabled ? "Disable" : "Enable"}
                        </button>
                        {confirmDelete === g.id ? (
                          <button
                            onClick={() => remove(g.id)}
                            className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-400 hover:bg-rose-500/20"
                          >
                            Confirm?
                          </button>
                        ) : (
                          <button
                            onClick={() => remove(g.id)}
                            className="rounded-md border border-line px-2.5 py-1 text-xs text-slate-400 hover:border-rose-500/40 hover:text-rose-400"
                          >
                            Delete
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      {/* OTP history */}
      <div className="rounded-xl border border-line bg-ink-800">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-sm font-semibold">OTP Activity</div>
          <div className="text-xs text-slate-500">Most recent {history.length} requests</div>
        </div>
        {history.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">No OTP activity yet.</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-5 py-2.5">Phone</th>
                <th className="px-5 py-2.5">Status</th>
                <th className="px-5 py-2.5">Attempts</th>
                <th className="px-5 py-2.5">Resends</th>
                <th className="px-5 py-2.5">Sent via</th>
                <th className="px-5 py-2.5">Requested</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <Fragment key={h.id}>
                  <tr
                    onClick={() => setExpanded(expanded === h.id ? null : h.id)}
                    className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-ink-700/30"
                  >
                    <td className="px-5 py-3 font-mono text-slate-300">{h.phone}</td>
                    <td className="px-5 py-3">
                      <Pill text={h.status} cls={OTP_STATUS[h.status] || OTP_STATUS.expired} />
                    </td>
                    <td className="px-5 py-3 text-slate-400">{h.attempts}/{h.max_attempts}</td>
                    <td className="px-5 py-3 text-slate-400">{h.resend_count}/{h.max_resends}</td>
                    <td className="px-5 py-3 text-slate-400">{h.sent_via || "—"}</td>
                    <td className="px-5 py-3 text-xs text-slate-500">{timeAgo(h.created_at)}</td>
                    <td className="px-5 py-3 text-right text-xs text-slate-500">{expanded === h.id ? "▲" : "▼"}</td>
                  </tr>
                  {expanded === h.id && (
                    <tr className="border-b border-line/60 bg-ink-900/40">
                      <td colSpan={7} className="px-5 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                          Send log
                        </div>
                        <div className="flex flex-col gap-1">
                          {h.send_log.length === 0 ? (
                            <div className="text-xs text-slate-500">No send attempts recorded.</div>
                          ) : (
                            h.send_log.map((l, i) => (
                              <div key={i} className="flex items-center gap-2.5 text-xs">
                                <span className={"h-1.5 w-1.5 rounded-full " + (l.ok ? "bg-emerald-400" : "bg-rose-400")} />
                                <span className="font-semibold text-slate-300">{l.gateway}</span>
                                <span className="text-slate-500">{timeAgo(l.at)}</span>
                                {l.error && <span className="text-rose-400">{l.error}</span>}
                              </div>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", required }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-slate-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="h-9 w-full rounded-lg border border-line bg-ink-700 px-3 font-mono text-[13px] outline-none focus:border-accent"
      />
    </div>
  );
}
