const META = {
  active: { label: "Active", cls: "text-emerald-400 bg-emerald-400/10" },
  provisioning: { label: "Provisioning", cls: "text-amber-400 bg-amber-400/10" },
  degraded: { label: "Degraded", cls: "text-amber-400 bg-amber-400/10" },
  stopped: { label: "Stopped", cls: "text-rose-400 bg-rose-400/10" },
};

export default function StatusPill({ status }) {
  const m = META[status] || META.active;
  return (
    <span className={"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold " + m.cls}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {m.label}
    </span>
  );
}
