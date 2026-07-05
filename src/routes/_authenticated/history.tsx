import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { confirmDialog } from "@/components/ConfirmDialog";

export const Route = createFileRoute("/_authenticated/history")({
  component: HistoryPage,
});

function HistoryPage() {
  const [q, setQ] = useState("");
  const qc = useQueryClient();
  const videos = useQuery({
    queryKey: ["shadowing_videos", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shadowing_videos")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const filtered = (videos.data ?? []).filter((v) =>
    (v.title ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  async function deleteVideo(v: { id: string; source_type: string; storage_path: string | null }) {
    if (!confirm("Delete this video and its notes?")) return;
    if (v.source_type === "upload" && v.storage_path) {
      await supabase.storage.from("shadowing-videos").remove([v.storage_path]);
    }
    await supabase.from("shadowing_notes").delete().eq("video_id", v.id);
    const { error } = await supabase.from("shadowing_videos").delete().eq("id", v.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["shadowing_videos"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
    toast.success("Video deleted");
  }

  async function clearAll() {
    if (!confirm("Delete ALL your shadowing history? This cannot be undone.")) return;
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;
    const uploads = (videos.data ?? []).filter((v) => v.source_type === "upload" && v.storage_path);
    if (uploads.length > 0) {
      await supabase.storage
        .from("shadowing-videos")
        .remove(uploads.map((u) => u.storage_path!));
    }
    await supabase.from("shadowing_notes").delete().eq("user_id", user.id);
    const { error } = await supabase.from("shadowing_videos").delete().eq("user_id", user.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["shadowing_videos"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
    toast.success("History cleared");
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <Link to="/shadowing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition">
        <ArrowLeft size={14} /> Back to shadowing
      </Link>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <p className="label-mono text-[color:var(--color-gold)]">Full history</p>
          <h1 className="text-3xl font-bold mt-1">All your videos</h1>
        </div>
        {(videos.data?.length ?? 0) > 0 && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-red-400 border border-[color:var(--color-border)] hover:border-red-500/40 rounded-lg px-3 py-2 transition"
          >
            <Trash2 size={14} /> Clear all
          </button>
        )}
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by title…"
        className="w-full glass-panel-soft px-4 py-3 rounded-lg"
      />
      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
        {filtered.map((v) => (
          <div
            key={v.id}
            className="glass-panel-soft rounded-lg overflow-hidden hover:border-[color:var(--color-crimson-glow)] transition group relative"
          >
            <Link to="/shadowing" className="block">
              <div className="aspect-video bg-black">
                {v.thumbnail_url ? (
                  <img src={v.thumbnail_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                    {v.source_type === "upload" ? "📁 Upload" : "▶ YouTube"}
                  </div>
                )}
              </div>
              <div className="p-3">
                <p className="text-sm font-medium truncate">{v.title || "Untitled"}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(v.created_at).toLocaleDateString("en-US")}
                </p>
              </div>
            </Link>
            <button
              onClick={(e) => {
                e.preventDefault();
                deleteVideo(v);
              }}
              className="absolute top-2 right-2 p-1.5 rounded-md bg-black/60 backdrop-blur text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
              aria-label="Delete video"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full text-center text-muted-foreground py-12">
            {q ? "No results" : "No videos yet"}
          </p>
        )}
      </div>
    </div>
  );
}
