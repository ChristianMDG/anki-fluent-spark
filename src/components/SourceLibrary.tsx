import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { confirmDialog } from "@/components/ConfirmDialog";
import {
  Link2,
  ChevronDown,
  Plus,
  Trash2,
  Pencil,
  Youtube,
  Facebook,
  Globe,
  ExternalLink,
  Check,
  X,
} from "lucide-react";

export type SourcePlatform = "facebook" | "youtube" | "other";

export interface ContentSourceRow {
  id: string;
  name: string;
  url: string;
  platform: SourcePlatform;
  notes: string | null;
  created_at: string;
}

export function detectPlatform(url: string): SourcePlatform {
  const u = url.toLowerCase();
  if (u.includes("facebook.com") || u.includes("fb.watch")) return "facebook";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  return "other";
}

function normalizeUrl(url: string): string {
  const t = url.trim();
  if (!t) return t;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function PlatformIcon({ platform }: { platform: SourcePlatform }) {
  if (platform === "youtube") return <Youtube size={14} className="text-red-500" />;
  if (platform === "facebook") return <Facebook size={14} className="text-blue-400" />;
  return <Globe size={14} className="text-neutral-400" />;
}

export function SourceLibrary() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const sources = useQuery({
    queryKey: ["content_sources"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("content_sources")
        .select("id,name,url,platform,notes,created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ContentSourceRow[];
    },
  });

  const addSource = useMutation({
    mutationFn: async () => {
      const cleanUrl = normalizeUrl(url);
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase.from("content_sources").insert({
        user_id: user.id,
        name: name.trim(),
        url: cleanUrl,
        platform: detectPlatform(cleanUrl),
        notes: notes.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setName("");
      setUrl("");
      setNotes("");
      setAdding(false);
      qc.invalidateQueries({ queryKey: ["content_sources"] });
      toast.success("Source added");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateSource = useMutation({
    mutationFn: async (vars: { id: string; name: string; notes: string }) => {
      const { error } = await supabase
        .from("content_sources")
        .update({ name: vars.name.trim(), notes: vars.notes.trim() || null })
        .eq("id", vars.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ["content_sources"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteSource = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("content_sources").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["content_sources"] });
      toast.success("Source removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleDelete(s: ContentSourceRow) {
    const ok = await confirmDialog({
      title: `Remove "${s.name}"?`,
      description: "This only removes the bookmark from your list.",
      confirmLabel: "Remove",
    });
    if (ok) deleteSource.mutate(s.id);
  }

  function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !url.trim()) {
      toast.error("Name and link are required");
      return;
    }
    addSource.mutate();
  }

  const list = sources.data ?? [];

  return (
    <div className="bg-gradient-to-br from-[#120403]/60 via-[#0d0605]/40 to-black/60 backdrop-blur-md border border-[var(--color-border)]/40 rounded-2xl shrink-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-[11px] uppercase tracking-wider text-neutral-300 hover:text-white transition"
      >
        <span className="flex items-center gap-2">
          <Link2 size={13} className="text-[var(--color-gold)]" />
          <span className="font-audiowide text-[var(--color-gold)]">My sources</span>
          {list.length > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-neutral-400">
              {list.length}
            </span>
          )}
        </span>
        <ChevronDown
          size={14}
          className={`transition-transform ${open ? "rotate-180" : ""} text-neutral-500`}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-2 animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="max-h-[220px] overflow-y-auto space-y-1.5 pr-1">
            {list.length === 0 && !sources.isLoading && (
              <p className="text-[11px] text-neutral-500 py-3">
                No sources yet — add pages or channels you like to check regularly.
              </p>
            )}
            {list.map((s) =>
              editingId === s.id ? (
                <div
                  key={s.id}
                  className="flex flex-col gap-1.5 rounded-lg border border-white/10 bg-black/40 p-2"
                >
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="bg-black/50 border border-white/10 rounded px-2 py-1 text-xs outline-none focus:border-[var(--color-gold)]/50"
                    placeholder="Name"
                  />
                  <input
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className="bg-black/50 border border-white/10 rounded px-2 py-1 text-xs outline-none focus:border-[var(--color-gold)]/50"
                    placeholder="Note (optional)"
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="p-1 text-neutral-500 hover:text-white"
                    >
                      <X size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateSource.mutate({ id: s.id, name: editName, notes: editNotes })
                      }
                      className="p-1 text-[var(--color-gold)] hover:text-white"
                    >
                      <Check size={13} />
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  key={s.id}
                  className="group flex items-center gap-2 rounded-lg border border-white/5 bg-black/30 hover:bg-black/50 hover:border-white/10 transition px-2 py-1.5"
                >
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 min-w-0 flex-1"
                  >
                    <PlatformIcon platform={s.platform} />
                    <span className="text-xs text-neutral-200 truncate">{s.name}</span>
                    {s.notes && (
                      <span className="text-[10px] text-neutral-500 truncate hidden sm:inline">
                        — {s.notes}
                      </span>
                    )}
                    <ExternalLink
                      size={11}
                      className="text-neutral-600 opacity-0 group-hover:opacity-100 transition shrink-0"
                    />
                  </a>
                  <button
                    type="button"
                    aria-label="Edit source"
                    onClick={() => {
                      setEditingId(s.id);
                      setEditName(s.name);
                      setEditNotes(s.notes ?? "");
                    }}
                    className="p-1 text-neutral-600 hover:text-[var(--color-gold)] transition"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete source"
                    onClick={() => handleDelete(s)}
                    className="p-1 text-neutral-600 hover:text-red-400 transition"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ),
            )}
          </div>

          {adding ? (
            <form
              onSubmit={submitAdd}
              className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr_1fr_auto] gap-2 pt-1"
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                autoFocus
                className="bg-black/50 border border-white/10 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[var(--color-gold)]/50"
              />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
                className="bg-black/50 border border-white/10 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[var(--color-gold)]/50"
              />
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Note (optional)"
                className="bg-black/50 border border-white/10 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[var(--color-gold)]/50"
              />
              <div className="flex gap-1">
                <button
                  type="submit"
                  disabled={addSource.isPending}
                  className="btn-crimson rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="px-2 text-neutral-500 hover:text-white"
                >
                  <X size={13} />
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 text-[11px] text-neutral-400 hover:text-[var(--color-gold)] transition pt-1"
            >
              <Plus size={12} /> Add source
            </button>
          )}
        </div>
      )}
    </div>
  );
}
