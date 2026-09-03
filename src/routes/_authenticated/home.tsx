import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, ArrowRight, Target, Flame, Play, Layers, Sparkles } from "lucide-react";
import { DailyGoalCard } from "@/components/DailyGoalCard";
import { ListenVsProduceCard } from "@/components/ListenVsProduceCard";
import { ContributionGrid } from "@/components/ContributionGrid";

export const Route = createFileRoute("/_authenticated/home")({
  component: HomePage,
});

function HomePage() {
  const stats = useQuery({
    queryKey: ["stats"],
    queryFn: async () => {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [
        cards,
        cardsWeek,
        lessons,
        lessonsWeek,
        videos,
        videosWeek,
        review,
        sessions,
      ] = await Promise.all([
        supabase.from("cards").select("id", { count: "exact", head: true }),
        supabase.from("cards").select("id", { count: "exact", head: true }).gte("created_at", oneWeekAgo),
        supabase.from("lessons").select("id", { count: "exact", head: true }),
        supabase.from("lessons").select("id", { count: "exact", head: true }).gte("created_at", oneWeekAgo),
        supabase.from("shadowing_videos").select("id", { count: "exact", head: true }),
        supabase.from("shadowing_videos").select("id", { count: "exact", head: true }).gte("created_at", oneWeekAgo),
        supabase.from("cards").select("id", { count: "exact", head: true }).eq("needs_review", true),
        supabase.from("fluency_sessions").select("completed_at").not("completed_at", "is", null).order("completed_at", { ascending: false }),
      ]);

      // Calculate streak
      let streak = 0;
      if (sessions.data && sessions.data.length > 0) {
        const days = new Set(
          sessions.data.map((r) => new Date(r.completed_at as string).toISOString().slice(0, 10)),
        );
        const cursor = new Date();
        // If today not present, start from yesterday
        if (!days.has(cursor.toISOString().slice(0, 10))) {
          cursor.setDate(cursor.getDate() - 1);
        }
        while (days.has(cursor.toISOString().slice(0, 10))) {
          streak++;
          cursor.setDate(cursor.getDate() - 1);
        }
      }

      return {
        cards: cards.count ?? 0,
        cardsWeek: cardsWeek.count ?? 0,
        lessons: lessons.count ?? 0,
        lessonsWeek: lessonsWeek.count ?? 0,
        videos: videos.count ?? 0,
        videosWeek: videosWeek.count ?? 0,
        review: review.count ?? 0,
        streak,
      };
    },
  });

  return (
    <div className="w-full h-full bg-transparent text-white selection:bg-[var(--color-crimson)] selection:text-white relative select-none perspective-1000 box-border">
      {/* INJECTED STYLE: Audiowide Import & HUD Animation */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Audiowide&display=swap');
        
        .font-audiowide {
          font-family: 'Audiowide', sans-serif;
        }
        @keyframes scanline {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100%); }
        }
        .hud-scanline::after {
          content: " ";
          display: block;
          position: absolute;
          top: 0; left: 0; bottom: 0; right: 0;
          background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 255, 0, 0.06));
          z-index: 2;
          background-size: 100% 2px, 3px 100%;
          pointer-events: none;
        }
      `}</style>

      {/* Ambient Background with crimson glow */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[var(--color-crimson)]/5 rounded-full blur-[120px] pointer-events-none z-0" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-[var(--color-gold)]/5 rounded-full blur-[100px] pointer-events-none z-0" />

      {/* Main layout container with compact margins and auto-fitting constraints */}
      <div className="max-w-7xl mx-auto space-y-5 relative z-10 animate-focus-cascade">
        {/* Akatsuki Header - Tactical HUD Version */}
        <header className="glass-panel p-4 sm:p-5 border-l-4 border-l-[var(--color-crimson)] bg-black/40 backdrop-blur-md border border-[var(--color-border)]/50 rounded-2xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-[0_15px_50px_rgba(0,0,0,0.5)]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-[var(--color-crimson)] shadow-[0_0_8px_var(--color-crimson)] animate-pulse" />
              <h2 className="font-audiowide text-[10px] tracking-[0.25em] text-[var(--color-gold)] uppercase">
                Organization: Akatsuki Global Corps
              </h2>
            </div>
            <h1 className="font-audiowide text-2xl sm:text-3xl font-black text-white uppercase tracking-tight">
              Dashboard<span className="text-[var(--color-crimson)]">.</span>
            </h1>
          </div>

          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-black/50 border border-[var(--color-crimson)]/30 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,0,0,0.4)]">
            <Flame
              size={14}
              className="text-[var(--color-gold)] drop-shadow-[0_0_5px_rgba(255,184,0,0.5)]"
            />
            <span className="font-audiowide text-[10px] font-bold text-white tracking-widest uppercase">
              {stats.data?.streak ?? 0} Day Streak
            </span>
          </div>
        </header>

        {/* Stats Grid with tactical icons */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={Layers}
            value={stats.data?.cards ?? 0}
            label="Total Cards"
            change={`+${stats.data?.cardsWeek ?? 0} this week`}
          />
          <StatCard
            icon={Play}
            value={stats.data?.lessons ?? 0}
            label="Lessons Completed"
            change={`+${stats.data?.lessonsWeek ?? 0} this week`}
          />
          <StatCard
            icon={Sparkles}
            value={stats.data?.videos ?? 0}
            label="Shadowing Vault"
            change={`+${stats.data?.videosWeek ?? 0} this week`}
          />
          <StatCard
            icon={Target}
            value={stats.data?.review ?? 0}
            label="Pending Review"
            change="urgent"
            isReview
          />
        </div>

        {/* Tactical Bento Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Main Column (Goals and Metrics) */}
          <div className="lg:col-span-2 space-y-5">
            <div className="glass-panel p-5 border-t-2 border-t-[var(--color-crimson)] bg-black/40 backdrop-blur-md border border-[var(--color-border)]/40 rounded-2xl shadow-xl">
              <DailyGoalCard />
            </div>
            <div className="glass-panel p-5 bg-black/40 backdrop-blur-md border border-[var(--color-border)]/40 rounded-2xl shadow-xl">
              <ListenVsProduceCard />
            </div>
          </div>

          {/* Side Panel (Activity & Rank Progression) */}
          <div className="space-y-5">
            {/* Operational Activity Grid */}
            <div className="glass-panel p-5 bg-black/40 backdrop-blur-md border border-[var(--color-border)]/40 rounded-2xl shadow-xl">
              <h3 className="font-audiowide text-[10px] tracking-wider uppercase text-neutral-400 mb-3 block border-b border-white/5 pb-1.5">
                Operational Activity
              </h3>
              <ContributionGrid />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, value, label, change, isReview }: any) {
  return (
    <div className="glass-panel p-4 border bg-gradient-to-br from-[#120403]/90 via-[#0d0605]/95 to-black/90 hover:border-[var(--color-crimson)]/80 border-[var(--color-border)]/40 rounded-2xl transition-all duration-500 cursor-pointer group hover:scale-[1.01] hover:shadow-[0_12px_25px_rgba(237,28,36,0.12)] relative overflow-hidden">
      {/* Laser Scanner Effect */}
      <div className="absolute inset-x-0 h-[1px] bg-[var(--color-crimson)]/20 opacity-0 group-hover:opacity-100 group-hover:animate-[scanline_2s_infinite_linear] pointer-events-none z-10" />

      <div className="flex items-center justify-between mb-3 relative z-20">
        {/* Icon badge with crimson frame */}
        <div className="w-10 h-10 rounded-xl border border-[var(--color-crimson)]/40 flex items-center justify-center bg-black/60 group-hover:border-[var(--color-crimson)] transition-all duration-500 shadow-inner">
          <Icon
            size={18}
            className="text-[var(--color-crimson)] group-hover:text-white transition-colors duration-500 drop-shadow-[0_0_6px_rgba(237,28,36,0.4)]"
          />
        </div>

        {/* HUD Warning / Status Badge */}
        {change === "urgent" && value > 0 ? (
          <div className="flex items-center gap-1 bg-red-950/60 px-1.5 py-0.5 rounded-md border border-red-800/60 animate-pulse">
            <AlertTriangle size={10} className="text-red-500" />
            <span className="font-audiowide text-[7px] tracking-widest text-red-400 uppercase">
              CRITICAL
            </span>
          </div>
        ) : (
          <span className="font-audiowide text-[8px] uppercase tracking-widest text-[var(--color-gold)] opacity-80 group-hover:opacity-100 transition-opacity">
            {change}
          </span>
        )}
      </div>

      {/* Data Metrics */}
      <div className="relative z-20 space-y-0.5">
        <div className="font-audiowide text-xl sm:text-2xl font-black text-white tracking-wide group-hover:text-[var(--color-crimson)] transition-colors duration-300">
          {value}
        </div>
        <div className="font-audiowide text-[8px] uppercase tracking-[0.15em] text-neutral-400 group-hover:text-neutral-200 transition-colors">
          {label}
        </div>
      </div>
    </div>
  );
}