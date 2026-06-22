import { useEffect, useState } from "react";
import { getSettings, updateSettings, getInfraStatus, getRealmFile, saveRealmFile, exportRealmToFile } from "../lib/api.js";

export default function Settings() {
  const [domain, setDomain] = useState("");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [infra, setInfra] = useState(null);
  const [infraLoading, setInfraLoading] = useState(true);

  const [realmText, setRealmText] = useState("");        // textarea content (string)
  const [realmDirty, setRealmDirty] = useState(false);  // unsaved edits
  const [realmLoading, setRealmLoading] = useState(false);
  const [realmSaving, setRealmSaving] = useState(false);
  const [realmMsg, setRealmMsg] = useState(null);        // { type, text }

  useEffect(() => {
    getSettings()
      .then((d) => { setDomain(d.domain); setDraft(d.domain); })
      .catch(() => {});

    getInfraStatus()
      .then(setInfra)
      .catch(() => setInfra(null))
      .finally(() => setInfraLoading(false));
  }, []);

  const dirty = draft.trim() && draft.trim() !== domain;

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    setMsg("");
    try {
      const d = await updateSettings({ domain: draft.trim() });
      setDomain(d.domain);
      setDraft(d.domain);
      setMsg("Domain updated — every service route now uses it (live).");
    } catch (err) {
      setMsg(err?.response?.data?.detail || "Could not update domain");
    } finally {
      setSaving(false);
    }
  };

  const setRealm = (data) => {
    setRealmText(JSON.stringify(data, null, 2));
    setRealmDirty(false);
    setRealmMsg(null);
  };

  const loadRealmFile = async () => {
    setRealmLoading(true);
    setRealmMsg(null);
    try {
      setRealm(await getRealmFile());
    } catch (e) {
      setRealmMsg({ type: "err", text: e?.response?.data?.detail || "Could not read realm.json file" });
    } finally {
      setRealmLoading(false);
    }
  };

  const pullFromKeycloak = async () => {
    setRealmLoading(true);
    setRealmMsg(null);
    try {
      // Import inline to avoid changing the import line above
      const { getKeycloakRealm } = await import("../lib/api.js");
      setRealm(await getKeycloakRealm());
      setRealmDirty(true); // pulled but not yet saved to file
      setRealmMsg({ type: "info", text: "Pulled from live Keycloak. Review and click Save to write to realm.json." });
    } catch (e) {
      setRealmMsg({ type: "err", text: e?.response?.data?.detail || "Could not export from Keycloak" });
    } finally {
      setRealmLoading(false);
    }
  };

  const saveRealm = async () => {
    let parsed;
    try {
      parsed = JSON.parse(realmText);
    } catch {
      setRealmMsg({ type: "err", text: "Invalid JSON — fix syntax errors before saving." });
      return;
    }
    setRealmSaving(true);
    setRealmMsg(null);
    try {
      await saveRealmFile(parsed);
      setRealmDirty(false);
      setRealmMsg({ type: "ok", text: "realm.json saved. Changes take effect on next fresh build (make clean && make build)." });
    } catch (e) {
      setRealmMsg({ type: "err", text: e?.response?.data?.detail || "Could not save realm.json" });
    } finally {
      setRealmSaving(false);
    }
  };

  const pullAndSave = async () => {
    setRealmLoading(true);
    setRealmMsg(null);
    try {
      const d = await exportRealmToFile();
      setRealmMsg({ type: "ok", text: `Live realm '${d.realm}' exported and saved to realm.json.` });
      await loadRealmFile();
    } catch (e) {
      setRealmMsg({ type: "err", text: e?.response?.data?.detail || "Export failed" });
    } finally {
      setRealmLoading(false);
    }
  };

  const downloadRealm = () => {
    if (!realmText) return;
    const blob = new Blob([realmText], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: "realm.json",
    });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const kc = infra?.keycloak;
  const cf = infra?.cloudflare;

  return (
    <div className="mx-auto max-w-xl">
      <div className="text-xl font-semibold tracking-tight">Settings</div>
      <div className="mb-6 mt-0.5 text-[13px] text-slate-400">Manage your domain, SSL, and Cloudflared tunnel.</div>

      {/* Domain */}
      <div className="mb-3.5 rounded-xl border border-line bg-ink-800 p-5">
        <div className="text-sm font-semibold">Domain &amp; SSL</div>
        <div className="mb-4 mt-0.5 text-xs text-slate-500">
          Primary domain serving frontend and backend. Changing it updates every service route.
        </div>
        <label className="mb-1.5 block text-xs text-slate-400">Domain</label>
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="example.com"
            className="h-9 flex-1 rounded-lg border border-line bg-ink-700 px-3 font-mono text-[13px] outline-none focus:border-accent"
          />
          <button
            onClick={save}
            disabled={!dirty || saving}
            className={
              "h-9 rounded-lg px-4 text-[13px] font-semibold " +
              (dirty && !saving
                ? "bg-accent text-ink-900 hover:brightness-110"
                : "cursor-not-allowed border border-line bg-ink-700 text-slate-500")
            }
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        {msg && <div className="mt-3 text-xs text-emerald-400">{msg}</div>}
        <div className="mt-4 flex items-center justify-between border-t border-line pt-3.5 text-[13px]">
          <span className="text-slate-400">SSL certificate</span>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Active · Cloudflare
          </span>
        </div>
      </div>

      {/* Keycloak */}
      <div className="mb-3.5 rounded-xl border border-line bg-ink-800 p-5">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Keycloak</div>
          {infraLoading ? (
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
          ) : (
            <StatusBadge ok={kc?.ready} label={kc?.ready ? "Connected" : "Pending"} />
          )}
        </div>
        <div className="mb-4 mt-0.5 text-xs text-slate-500">
          Centralised SSO — auto-provisions realm &amp; client on first boot.
        </div>
        <Row label="Realm" value={kc?.realm ?? "standalone"} mono />
        <Row label="Client ID" value={kc?.client_id ?? "sss-frontend"} mono />
        <Row label="JWKS keys cached" value={infraLoading ? "…" : String(kc?.jwks_keys ?? 0)} mono />
        <Row
          label="Admin console"
          value={
            <a
              href={(kc?.public_url ?? "http://localhost:8180") + "/admin"}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-accent hover:underline"
            >
              {(kc?.public_url ?? "http://localhost:8180").replace(/^https?:\/\//, "")}
            </a>
          }
        />
      </div>

      {/* Keycloak Realm JSON Editor */}
      <div className="mb-3.5 rounded-xl border border-line bg-ink-800 p-5">
        <div className="text-sm font-semibold">Realm JSON</div>
        <div className="mt-0.5 text-xs text-slate-500">
          Edit <span className="font-mono">keycloak/realm.json</span> — the file imported on fresh build.
          Use <span className="font-mono text-slate-300">Pull from Keycloak</span> to snapshot the live config,
          then <span className="font-mono text-slate-300">Save</span> to persist it.{" "}
          <a
            href={`${kc?.public_url ?? "http://localhost:8180"}/admin/master/console/#/${kc?.realm ?? "standalone"}`}
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            Open Keycloak admin console →
          </a>
        </div>

        {/* Action buttons */}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={loadRealmFile}
            disabled={realmLoading}
            className="h-8 rounded-lg border border-line px-3 text-xs text-slate-300 hover:border-accent/40 hover:text-accent disabled:opacity-40"
          >
            {realmLoading ? "Loading…" : "Load from file"}
          </button>
          <button
            onClick={pullFromKeycloak}
            disabled={realmLoading}
            className="h-8 rounded-lg border border-line px-3 text-xs text-slate-300 hover:border-accent/40 hover:text-accent disabled:opacity-40"
          >
            Pull from Keycloak
          </button>
          <button
            onClick={pullAndSave}
            disabled={realmLoading || realmSaving}
            className="h-8 rounded-lg border border-line px-3 text-xs text-slate-300 hover:border-emerald-500/40 hover:text-emerald-400 disabled:opacity-40"
          >
            Pull &amp; Save
          </button>
          {realmText && (
            <button
              onClick={downloadRealm}
              className="h-8 rounded-lg border border-line px-3 text-xs text-slate-300 hover:border-accent/40 hover:text-accent"
            >
              Download
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={saveRealm}
            disabled={!realmText || realmSaving || realmLoading}
            className={
              "h-8 rounded-lg px-4 text-xs font-semibold " +
              (realmText && !realmSaving && !realmLoading
                ? realmDirty
                  ? "bg-accent text-ink-900 hover:brightness-110"
                  : "border border-line text-slate-400 hover:border-accent/40 hover:text-accent"
                : "cursor-not-allowed border border-line text-slate-600")
            }
          >
            {realmSaving ? "Saving…" : "Save to file"}
          </button>
        </div>

        {/* Status message */}
        {realmMsg && (
          <div className={
            "mt-3 rounded-lg px-3 py-2 text-xs " +
            (realmMsg.type === "ok" ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : realmMsg.type === "info" ? "border border-accent/30 bg-accent/10 text-accent"
              : "border border-rose-500/30 bg-rose-500/10 text-rose-300")
          }>
            {realmMsg.text}
          </div>
        )}

        {/* JSON editor */}
        {realmText ? (
          <div className="relative mt-4">
            <textarea
              value={realmText}
              onChange={(e) => { setRealmText(e.target.value); setRealmDirty(true); setRealmMsg(null); }}
              spellCheck={false}
              rows={20}
              className="w-full rounded-lg border border-line bg-ink-900 p-3 font-mono text-[11px] text-slate-300 outline-none focus:border-accent/50 resize-y"
            />
            {realmDirty && (
              <span className="absolute right-3 top-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                unsaved
              </span>
            )}
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-line py-8 text-center text-xs text-slate-500">
            Click <span className="text-slate-300">Load from file</span> to edit realm.json,
            or <span className="text-slate-300">Pull from Keycloak</span> to snapshot the live config.
          </div>
        )}
      </div>

      {/* Cloudflared */}
      <div className="rounded-xl border border-line bg-ink-800 p-5">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Cloudflared tunnel</div>
          {infraLoading ? (
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
          ) : cf?.configured ? (
            <StatusBadge ok={cf?.status === "healthy"} label={cf?.status ?? "unknown"} />
          ) : (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-400">
              Not configured
            </span>
          )}
        </div>
        <div className="mb-4 mt-0.5 text-xs text-slate-500">
          Dynamic DNS CNAME + tunnel ingress for all registered services.
          {!cf?.configured && (
            <span className="ml-1 text-amber-400">
              Set CLOUDFLARE_API_TOKEN to enable automatic DNS provisioning.
            </span>
          )}
        </div>
        {cf?.configured ? (
          <>
            <Row label="Tunnel ID" value={cf.tunnel_id} mono muted />
            <Row label="Tunnel name" value={cf.name || "—"} mono />
            <Row label="Active connections" value={String(cf.connections ?? 0)} mono />
            {cf.error && (
              <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {cf.error}
              </div>
            )}
          </>
        ) : (
          <Row label="Status" value="Disabled" muted />
        )}
      </div>
    </div>
  );
}

function StatusBadge({ ok, label }) {
  return (
    <span
      className={
        "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold " +
        (ok ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
            : "border border-amber-500/30 bg-amber-500/10 text-amber-400")
      }
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
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
