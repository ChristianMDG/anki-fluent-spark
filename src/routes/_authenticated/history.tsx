import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/history")({
  component: HistoryPage,
});

function HistoryPage() {
  const [q, setQ] = useState("");
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

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Link to="/shadowing" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> Retour au shadowing
      </Link>
      <div>
        <p className="label-mono text-[color:var(--color-gold)]">Historique complet</p>
        <h1 className="text-3xl font-bold mt-1">Toutes tes vidéos</h1>
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Rechercher par titre…"
        className="w-full glass-panel-soft px-4 py-3 rounded-lg"
      />
      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
        {filtered.map((v) => (
          <Link
            key={v.id}
            to="/shadowing"
            className="glass-panel-soft rounded-lg overflow-hidden hover:border-[color:var(--color-crimson-glow)] transition"
          >
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
              <p className="text-sm font-medium truncate">{v.title || "Sans titre"}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(v.created_at).toLocaleDateString("fr-FR")}
              </p>
            </div>
          </Link>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full text-center text-muted-foreground py-12">
            {q ? "Aucun résultat" : "Aucune vidéo pour l'instant"}
          </p>
        )}
      </div>
    </div>
  );
}
