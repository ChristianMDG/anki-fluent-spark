import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { 
  AlertTriangle, ArrowRight, Target, Flame, Play, Layers, Sparkles 
} from "lucide-react";
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
      const [cards, lessons, videos, review] = await Promise.all([
        supabase.from("cards").select("id", { count: "exact", head: true }),
        supabase.from("lessons").select("id", { count: "exact", head: true }),
        supabase.from("shadowing_videos").select("id", { count: "exact", head: true }),
        supabase.from("cards").select("id", { count: "exact", head: true }).eq("needs_review", true),
      ]);
      return { cards: cards.count ?? 0, lessons: lessons.count ?? 0, videos: videos.count ?? 0, review: review.count ?? 0 };
    },
  });

  return (
    <div className="min-h-screen py-8 px-4 sm:px-6">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header Akatsuki */}
        <header className="glass-panel p-8 border-l-4 border-l-[var(--color-crimson)] flex justify-between items-center">
          <div>
            <h2 className="label-mono text-[var(--color-gold)] mb-1">Organization: Akatsuki</h2>
            <h1 className="text-4xl font-bold text-white tracking-tight">Dashboard.</h1>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/20 border border-[var(--color-crimson)]/30">
            <Flame size={18} className="text-[var(--color-gold)]" />
            <span className="text-sm font-bold text-white">7 Jours de série</span>
          </div>
        </header>

        {/* Stats Grid avec portraits Akatsuki */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard img="https://i.pinimg.com/236x/8d/3f/19/8d3f191b935661a3d3c8c7348981442d.jpg" value={stats.data?.cards ?? 0} label="Total Cards" change="+12%" />
          <StatCard img="https://i.pinimg.com/236x/2b/9c/6b/2b9c6b75c5e8c1a9b7e7c4f4405a3b2a.jpg" value={stats.data?.lessons ?? 0} label="Lessons" change="+8%" />
          <StatCard img="https://i.pinimg.com/236x/e6/5a/8e/e65a8e0f17e0892095f9215038c353f8.jpg" value={stats.data?.videos ?? 0} label="Shadowing" change="+5%" />
          <StatCard img="https://i.pinimg.com/236x/3f/5c/4a/3f5c4a5c954067332349079737976192.jpg" value={stats.data?.review ?? 0} label="À réviser" change="urgent" isReview />
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="glass-panel p-6 border-t-2 border-t-[var(--color-crimson)]">
              <DailyGoalCard />
            </div>
            <div className="glass-panel p-6">
              <ListenVsProduceCard />
            </div>
          </div>

          <div className="space-y-6">
            <div className="glass-panel p-6">
              <h3 className="mini-title">Activité</h3>
              <ContributionGrid />
            </div>
            <div className="glass-panel-soft p-6 border-[var(--color-gold)]/20">
               <h3 className="mini-title text-[var(--color-gold)]">Rank Progression</h3>
               <div className="mt-4 space-y-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--color-muted-foreground)]">Niveau</span>
                    <span className="text-[var(--color-gold)] font-bold">Genin</span>
                  </div>
                  <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--color-gold)] w-[65%] shadow-[0_0_15px_var(--color-gold)]" />
                  </div>
               </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ img, value, label, change, isReview }: any) {
  return (
    <div className="glass-panel p-5 border-none bg-gradient-to-br from-[#1a0a08]/80 to-[#0d0605] hover:border-[var(--color-crimson)] border transition-all cursor-pointer group">
      <div className="flex items-center justify-between mb-4">
        <div className="w-12 h-12 rounded-full border-2 border-[var(--color-crimson)]/30 overflow-hidden bg-black/40 grayscale group-hover:grayscale-0 transition-all">
          <img src={img} alt="Akatsuki" className="w-full h-full object-cover" />
        </div>
        {change === 'urgent' && value > 0 ? (
          <AlertTriangle size={14} className="text-red-500 animate-pulse"/>
        ) : (
          <span className="text-[10px] uppercase font-mono text-[var(--color-gold)]">{change}</span>
        )}
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="label-mono text-[10px] mt-1">{label}</div>
    </div>
  );
}