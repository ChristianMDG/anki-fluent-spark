import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { confirmDialog } from "@/components/ConfirmDialog";

export const Route = createFileRoute("/_authenticated/history")({
  component: HistoryPage,
});

function HistoryPage() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const qc = useQueryClient();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(timer);
  }, [q]);

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
    (v.title ?? "").toLowerCase().includes(debouncedQ.toLowerCase()),
  );

  async function deleteVideo(v: { id: string; source_type: string; storage_path: string | null; title: string | null }) {
    const ok = await confirmDialog({
      title: "Delete this video?",
      description: `"${v.title || "Untitled"}" and all its notes will be permanently removed.`,
      confirmLabel: "Delete video",
    });
    if (!ok) return;
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
    const ok = await confirmDialog({
      title: "Clear all shadowing history?",
      description: "Every video and note will be permanently deleted. This cannot be undone.",
      confirmLabel: "Delete everything",
    });
    if (!ok) return;
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
        {videos.isLoading ? (
          <>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="glass-panel-soft rounded-lg overflow-hidden animate-pulse">
                <div className="aspect-video bg-white/10" />
                <div className="p-3 space-y-2">
                  <div className="h-4 bg-white/10 rounded w-3/4" />
                  <div className="h-3 bg-white/5 rounded w-1/2" />
                </div>
              </div>
            ))}
          </>
        ) : videos.isError ? (
          <div className="col-span-full glass-panel p-8 text-center space-y-3">
            <p className="text-sm text-red-400">Failed to load shadowing video history.</p>
            <button
              onClick={() => videos.refetch()}
              className="px-4 py-2 rounded-lg bg-red-500/20 border border-red-500/40 text-xs text-white font-mono uppercase cursor-pointer"
            >
              Try again
            </button>
          </div>
        ) : (
          filtered.map((v) => (
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
                      {v.source_type === "upload"
                        ? "📁 Upload"
                        : v.source_type === "facebook"
                          ? "▶ Facebook"
                          : "▶ YouTube"}
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
          ))
        )}
        {!videos.isLoading && !videos.isError && filtered.length === 0 && (
          <div className="col-span-full glass-panel-soft p-12 text-center text-muted-foreground space-y-2">
            <p className="text-sm font-medium">{debouncedQ ? "No matching videos found" : "No shadowing history yet"}</p>
            <p className="text-xs text-neutral-500">
              {debouncedQ
                ? `No videos match "${debouncedQ}". Try another term.`
                : "Practice with YouTube or Facebook videos in the Shadowing module to populate your history."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
