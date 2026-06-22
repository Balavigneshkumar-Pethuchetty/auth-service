import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { uploadConfig, setupService } from "../lib/api.js";

export default function Upload() {
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async (promise) => {
    setBusy(true);
    setError("");
    try {
      const svc = await promise;
      navigate("/services/" + svc.id);
    } catch (err) {
      setError(err?.response?.data?.detail || "Upload failed — is the backend running?");
      setBusy(false);
    }
  };

  const onFile = (file) => {
    if (!file) return;
    send(uploadConfig(file));
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    onFile(e.dataTransfer.files?.[0]);
  };

  const useSample = () => {
    send(
      setupService({
        name: "payment-gateway",
        type: "Cloudflared",
        subdomain: "payments",
        port: 8443,
        config: { service: "payment-gateway", subdomain: "payments", port: 8443, env: "production" },
      })
    );
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="text-xl font-semibold tracking-tight">Upload configuration</div>
      <div className="mb-6 mt-0.5 text-[13px] text-slate-400">
        Register a new standalone service from a JSON or YAML config file.
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={onDrop}
        className={
          "rounded-2xl border-2 border-dashed p-11 text-center transition " +
          (dragging ? "border-accent bg-accent/10" : "border-slate-600 bg-ink-800")
        }
      >
        <div className="mx-auto mb-3.5 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 16V4m0 0l-4 4m4-4l4 4" />
            <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
          </svg>
        </div>
        <div className="text-[15px] font-semibold">Drop your config file here</div>
        <div className="mb-4 mt-1 text-xs text-slate-500">
          Supports <span className="font-mono">.json</span> and <span className="font-mono">.yaml</span>
        </div>

        {busy ? (
          <div className="flex items-center justify-center gap-2.5 text-sm text-slate-300">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Registering & provisioning…
          </div>
        ) : (
          <div className="flex justify-center gap-2.5">
            <button
              onClick={() => fileRef.current?.click()}
              className="h-9 rounded-lg border border-slate-600 bg-ink-800 px-4 text-[13px] font-semibold hover:border-accent"
            >
              Browse files
            </button>
            <button
              onClick={useSample}
              className="h-9 rounded-lg bg-accent/15 px-4 text-[13px] font-semibold text-accent hover:bg-accent/25"
            >
              Use sample config
            </button>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".json,.yaml,.yml"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <p className="mt-5 text-center text-xs text-slate-500">
        Once registered, the backend provisions the service and flips its status to{" "}
        <span className="text-emerald-400">Active</span> — you'll see it update live.
      </p>
    </div>
  );
}
