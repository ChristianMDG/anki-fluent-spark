import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AlertTriangle, X } from "lucide-react";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (v: boolean) => void;
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let setPending: ((p: Pending | null) => void) | null = null;

function ConfirmHost() {
  const [pending, _setPending] = useState<Pending | null>(null);
  useEffect(() => {
    setPending = _setPending;
    return () => {
      setPending = null;
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  function close(v: boolean) {
    if (!pending) return;
    pending.resolve(v);
    _setPending(null);
  }

  if (!pending) return null;
  const destructive = pending.destructive ?? true;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={() => close(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        className="glass-panel max-w-sm w-full p-6 space-y-4 animate-in zoom-in-95 fade-in duration-200"
      >
        <div className="flex items-start gap-3">
          <div
            className={`shrink-0 grid place-items-center w-10 h-10 rounded-full ${
              destructive ? "bg-red-500/15 text-red-400" : "bg-[color:var(--color-gold)]/15 text-[color:var(--color-gold)]"
            }`}
          >
            <AlertTriangle size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold leading-snug">{pending.title}</h2>
            {pending.description && (
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                {pending.description}
              </p>
            )}
          </div>
          <button
            onClick={() => close(false)}
            className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={() => close(false)}
            className="rounded-lg px-4 py-2 text-sm border border-[color:var(--color-border)] text-muted-foreground hover:text-foreground transition"
          >
            {pending.cancelLabel ?? "Cancel"}
          </button>
          <button
            onClick={() => close(true)}
            autoFocus
            className={
              destructive
                ? "rounded-lg px-4 py-2 text-sm font-medium bg-red-500/90 hover:bg-red-500 text-white transition shadow-lg shadow-red-500/20"
                : "btn-crimson rounded-lg px-4 py-2 text-sm font-medium"
            }
          >
            {pending.confirmLabel ?? "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ensureMounted() {
  if (typeof document === "undefined") return;
  if (host) return;
  host = document.createElement("div");
  host.setAttribute("data-confirm-host", "");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<ConfirmHost />);
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  ensureMounted();
  return new Promise((resolve) => {
    const attempt = (tries: number) => {
      if (setPending) {
        setPending({ ...opts, resolve });
      } else if (tries > 0) {
        setTimeout(() => attempt(tries - 1), 10);
      } else {
        resolve(false);
      }
    };
    attempt(20);
  });
}
