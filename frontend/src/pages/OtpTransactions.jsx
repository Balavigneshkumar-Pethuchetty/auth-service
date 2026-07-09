import { useEffect, useMemo, useState, useCallback } from "react";
import { getEventManagementOtpTransactions } from "../lib/api.js";

const STATUS_STYLE = {
  verified: "text-emerald-400 bg-emerald-400/10",
  pending: "text-amber-400 bg-amber-400/10",
  expired: "text-slate-400 bg-slate-400/10",
  locked: "text-rose-400 bg-rose-400/10",
};

function Pill({ text, cls }) {
  return (
    <span className={"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold " + (cls || STATUS_STYLE.expired)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {text}
    </span>
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

function fmt(unixSeconds) {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function ago(unixSeconds) {
  if (!unixSeconds) return "";
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return Math.floor(diff) + "s ago";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

export default function OtpTransactions() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await getEventManagementOtpTransactions();
      setRows(d.transactions || []);
      setError("");
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not reach event-management's otp-service");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const stats = useMemo(() => {
    const by = (s) => rows.filter((r) => r.status === s).length;
    return {
      total: rows.length,
      verified: by("verified"),
      pending: by("pending"),
      expired: by("expired"),
      locked: by("locked"),
      smsFailed: rows.filter((r) => r.sms_delivery_failed).length,
    };
  }, [rows]);

  return (
    <div>
      <div className="mb-4">
        <div className="text-xl font-semibold tracking-tight">OTP Transactions</div>
        <div className="mt-0.5 text-[13px] text-slate-400">
          Real login OTP challenges from event-management (society-events) · developer debugging view · refreshes every 10s
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-slate-400">
        The OTP value itself is never shown here — it's never stored anywhere in recoverable form (only an HMAC hash),
        by design, so a compromised dashboard view can't be used to complete someone else's login. Phone numbers are
        masked to the last 4 digits, matching event-management's own convention.
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="TOTAL" value={stats.total} />
        <Stat label="VERIFIED" value={stats.verified} valueClass="text-emerald-400" />
        <Stat label="PENDING" value={stats.pending} valueClass="text-amber-400" />
        <Stat label="EXPIRED" value={stats.expired} />
        <Stat label="LOCKED" value={stats.locked} valueClass="text-rose-400" />
        <Stat label="SMS SEND FAILED" value={stats.smsFailed} valueClass={stats.smsFailed > 0 ? "text-rose-400" : ""} />
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-line bg-ink-800">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="text-sm font-semibold">Transaction Log</div>
          <div className="text-xs text-slate-500">{rows.length} shown (most recent 200 audit events)</div>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">No OTP activity yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-2.5">Phone</th>
                  <th className="px-5 py-2.5">Status</th>
                  <th className="px-5 py-2.5">Generated</th>
                  <th className="px-5 py-2.5">Verified</th>
                  <th className="px-5 py-2.5">Failed</th>
                  <th className="px-5 py-2.5">Expires</th>
                  <th className="px-5 py-2.5">Attempts</th>
                  <th className="px-5 py-2.5">SMS</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-line/60 last:border-0 hover:bg-ink-700/30">
                    <td className="px-5 py-3 font-mono text-slate-300">{r.phone}</td>
                    <td className="px-5 py-3">
                      <Pill text={r.status} cls={STATUS_STYLE[r.status]} />
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-400" title={fmt(r.generated_at)}>{ago(r.generated_at)}</td>
                    <td className="px-5 py-3 text-xs text-slate-400" title={fmt(r.verified_at)}>
                      {r.verified_at ? fmt(r.verified_at) : "—"}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-400" title={r.last_error || ""}>
                      {r.failed_at ? fmt(r.failed_at) : "—"}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">{fmt(r.expires_at)}</td>
                    <td className="px-5 py-3 text-slate-400">{r.attempts}</td>
                    <td className="px-5 py-3">
                      {r.sms_delivery_failed ? (
                        <span className="text-xs text-rose-400">failed</span>
                      ) : (
                        <span className="text-xs text-emerald-400">ok</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
