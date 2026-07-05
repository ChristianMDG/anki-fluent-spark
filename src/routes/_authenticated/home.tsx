import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Video } from "lucide-react";

export const Route = createFileRoute("/_authenticated/home")({
  component: HomePage,
});

function HomePage() {
  const stats = useQuery({
    queryKey: ["stats"],
    queryFn: async () => {
      const [cards, lessons, videos] = await Promise.all([
        supabase.from("cards").select("id", { count: "exact", head: true }),
        supabase.from("lessons").select("id", { count: "exact", head: true }),
        supabase.from("shadowing_videos").select("id", { count: "exact", head: true }),
      ]);
      return {
        cards: cards.count ?? 0,
        lessons: lessons.count ?? 0,
        videos: videos.count ?? 0,
      };
    },
  });

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <p className="label-mono text-[color:var(--color-gold)]">Welcome back</p>
        <h1 className="text-3xl md:text-4xl font-bold mt-1">
          Prêt·e pour ta prochaine session ?
        </h1>
        <p className="text-muted-foreground mt-2">
          Génère des fiches, plonge dans des leçons complètes, ou entraîne-toi au shadowing.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 md:gap-4">
        <StatCard label="Mots générés" value={stats.data?.cards ?? 0} />
        <StatCard label="Leçons consultées" value={stats.data?.lessons ?? 0} />
        <StatCard label="Vidéos shadowing" value={stats.data?.videos ?? 0} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <ActionCard
          to="/generate"
          icon={<Sparkles size={28} />}
          title="Générer une fiche"
          desc="Un mot en anglais → une fiche complète prête pour Anki."
        />
        <ActionCard
          to="/shadowing"
          icon={<Video size={28} />}
          title="Shadowing sur vidéo"
          desc="YouTube ou upload local, prends des notes, génère des fiches."
        />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass-panel p-4 md:p-5 text-center">
      <div className="text-3xl md:text-4xl font-bold text-[color:var(--color-gold)]">{value}</div>
      <div className="label-mono mt-1">{label}</div>
    </div>
  );
}

function ActionCard({
  to,
  icon,
  title,
  desc,
}: {
  to: "/generate" | "/shadowing";
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      to={to}
      className="glass-panel p-6 md:p-8 flex flex-col gap-3 hover:border-[color:var(--color-crimson-glow)] transition-all hover:-translate-y-0.5"
    >
      <div className="text-[color:var(--color-gold)]">{icon}</div>
      <h3 className="text-xl font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </Link>
  );
}
