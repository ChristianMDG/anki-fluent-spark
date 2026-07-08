import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Video, AlertTriangle, Library } from "lucide-react";
import { DailyGoalCard } from "@/components/DailyGoalCard";
import { ListenVsProduceCard } from "@/components/ListenVsProduceCard";

export const Route = createFileRoute("/_authenticated/home")({
  component: HomePage,
});

function HomePage() {
  const stats = useQuery({
    queryKey: ["stats"],
    queryFn: async () => {
      const [cards, lessons, videos, review] = await Promise.all([
        supabase.from("cards").select("id", { count: "exact", head: true }),
        supabase.from("lessons").select("id", { count: "exact", head: true }),
        supabase.from("shadowing_videos").select("id", { count: "exact", head: true }),
        supabase
          .from("cards")
          .select("id", { count: "exact", head: true })
          .eq("needs_review", true),
      ]);
      return {
        cards: cards.count ?? 0,
        lessons: lessons.count ?? 0,
        videos: videos.count ?? 0,
        review: review.count ?? 0,
      };
    },
  });

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div>
        <p className="label-mono text-[color:var(--color-gold)]">Welcome back</p>
        <h1 className="text-3xl md:text-4xl font-bold mt-1">
          Ready for your next session?
        </h1>
        <p className="text-muted-foreground mt-2">
          Generate cards, dive into full lessons, or practice with shadowing.
        </p>
      </div>

      <DailyGoalCard />

      <ListenVsProduceCard />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Words generated" value={stats.data?.cards ?? 0} />
        <StatCard label="Lessons opened" value={stats.data?.lessons ?? 0} />
        <StatCard label="Shadowing videos" value={stats.data?.videos ?? 0} />
        <Link
          to="/library"
          search={{ review: "1" }}
          className="glass-panel p-4 md:p-5 text-center transition hover:-translate-y-0.5 hover:border-amber-500/60 group"
          title="Voir les fiches à revoir"
        >
          <div className="flex items-center justify-center gap-1.5">
            <AlertTriangle
              size={16}
              className="text-amber-400 opacity-70 group-hover:opacity-100 transition"
            />
            <div className="text-3xl md:text-4xl font-bold text-amber-300">
              {stats.data?.review ?? 0}
            </div>
          </div>
          <div className="label-mono mt-1">À revoir</div>
        </Link>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <ActionCard
          to="/generate"
          icon={<Sparkles size={28} />}
          title="Generate a card"
          desc="One English word → a full card ready for Anki."
        />
        <ActionCard
          to="/library"
          icon={<Library size={28} />}
          title="Mes fiches"
          desc="Filtre par tags, tri, révisions."
        />
        <ActionCard
          to="/shadowing"
          icon={<Video size={28} />}
          title="Video shadowing"
          desc="YouTube or local upload, take notes, generate cards."
        />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass-panel p-4 md:p-5 text-center transition hover:-translate-y-0.5">
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
  to: "/generate" | "/shadowing" | "/library";
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      to={to}
      className="glass-panel p-6 md:p-8 flex flex-col gap-3 hover:border-[color:var(--color-crimson-glow)] transition-all duration-200 hover:-translate-y-1"
    >
      <div className="text-[color:var(--color-gold)]">{icon}</div>
      <h3 className="text-xl font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </Link>
  );
}
