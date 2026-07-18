import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Flame, Trophy, Activity } from "lucide-react";
import { useMemo } from "react";

const WEEKS = 17; // ~4 months
const DAYS = WEEKS * 7;

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Couleurs d'intensité adaptées au thème Akatsuki (Bases de sombres mats vers Crimson pur)
function intensityClass(n: number) {
  if (n === 0) return "bg-neutral-950/80 border-white/5";
  if (n <= 2) return "bg-[var(--color-crimson)]/20 border-[var(--color-crimson)]/30";
  if (n <= 5) return "bg-[var(--color-crimson)]/50 border-[var(--color-crimson)]/60";
  return "bg-[var(--color-crimson)] border-red-400 shadow-[0_0_8px_var(--color-crimson)]";
}

export function ContributionGrid() {
  const q = useQuery({
    queryKey: ["cards", "streak-heatmap"],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 400);
      const { data, error } = await supabase
        .from("cards")
        .select("created_at")
        .gte("created_at", since.toISOString());
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const c of data ?? []) {
        const key = ymd(new Date(c.created_at as string));
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return counts;
    },
  });

  const { grid, monthLabels, currentStreak, bestStreak, todayCount } = useMemo(() => {
    const counts = q.data ?? new Map<string, number>();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - (DAYS - 1));
    const startDow = startDate.getDay(); // 0=Sun
    startDate.setDate(startDate.getDate() - startDow);

    const totalDays = Math.ceil((today.getTime() - startDate.getTime()) / 86400000) + 1;
    const weeks = Math.ceil((totalDays + startDate.getDay()) / 7);

    const grid: { date: Date; count: number; inFuture: boolean }[][] = Array.from(
      { length: 7 },
      () => [],
    );
    const monthLabels: (string | null)[] = [];
    for (let w = 0; w < weeks; w++) {
      let labeled = false;
      for (let d = 0; d < 7; d++) {
        const date = new Date(startDate);
        date.setDate(startDate.getDate() + w * 7 + d);
        const inFuture = date.getTime() > today.getTime();
        const count = inFuture ? 0 : (counts.get(ymd(date)) ?? 0);
        grid[d].push({ date, count, inFuture });
        if (!labeled && date.getDate() <= 7 && !inFuture) {
          monthLabels.push(date.toLocaleDateString("en-US", { month: "short" }));
          labeled = true;
        }
      }
      if (!labeled) monthLabels.push(null);
    }

    // Streak calc
    let cur = 0;
    const cursor = new Date(today);
    while ((counts.get(ymd(cursor)) ?? 0) > 0) {
      cur += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    let best = 0;
    let run = 0;
    const dates = [...counts.keys()].sort();
    let prev: Date | null = null;
    for (const key of dates) {
      const d = new Date(key);
      if (prev && (d.getTime() - prev.getTime()) / 86400000 === 1) run += 1;
      else run = 1;
      if (run > best) best = run;
      prev = d;
    }
    const todayCount = counts.get(ymd(today)) ?? 0;

    return { grid, monthLabels, currentStreak: cur, bestStreak: Math.max(best, cur), todayCount };
  }, [q.data]);

  return (
    <section className="p-5 md:p-6 bg-gradient-to-br from-[#120403]/60 via-[#0d0605]/40 to-black/60 backdrop-blur-md border border-[var(--color-border)]/40 rounded-2xl shadow-xl w-full flex flex-col justify-between h-full min-h-0 overflow-hidden">
      
      {/* Top Header Row with Streak & Record metrics */}
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Activity size={13} className="text-[var(--color-gold)]" />
            <p className="font-audiowide text-[11px] tracking-wider uppercase text-[var(--color-gold)]">Activity Registry</p>
          </div>
          <div className="flex items-baseline gap-3">
            <h2 className="text-xl md:text-2xl font-bold font-audiowide flex items-center gap-2 text-white uppercase tracking-tight">
              <Flame size={20} className={currentStreak > 0 ? "text-[var(--color-crimson)] animate-pulse" : "text-neutral-600"} style={{ fill: currentStreak > 0 ? "currentColor" : "none" }} />
              {currentStreak} <span className="text-xs font-mono text-neutral-400 lowercase font-normal">day{currentStreak !== 1 && 's'} streak</span>
            </h2>
            <span className="text-[10px] font-mono text-neutral-400 bg-neutral-950/60 border border-white/5 px-2 py-0.5 rounded flex items-center gap-1">
              <Trophy size={10} className="text-[var(--color-gold)]" /> RECORD: {bestStreak}D
            </span>
          </div>
          {todayCount === 0 && currentStreak === 0 && bestStreak > 0 && (
            <div className="flex items-center gap-1.5 mt-2 text-[10px] font-audiowide text-amber-500/90 tracking-wide uppercase">
              <span className="w-1 h-1 rounded-full bg-amber-500 animate-ping" />
              Generate a word today to initialize system streak!
            </div>
          )}
        </div>

        {/* Legend Panel */}
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-neutral-500 bg-neutral-950/40 border border-white/5 px-2 py-1 rounded-md">
          <span>Less</span>
          {[0, 1, 4, 8].map((n) => (
            <span
              key={n}
              className={`inline-block w-2.5 h-2.5 rounded-[3px] border ${intensityClass(n)}`}
            />
          ))}
          <span>More</span>
        </div>
      </div>

      {/* Heatmap Matrix Display Section */}
      <div className="overflow-x-auto -mx-2 px-2 pb-1 scrollbar-thin scrollbar-thumb-white/10">
        <div className="min-w-fit">
          {/* Months labels */}
          <div className="flex gap-[3px] pl-6 mb-1 text-[9px] font-mono font-bold text-neutral-500 uppercase tracking-wider">
            {monthLabels.map((m, i) => (
              <div key={i} className="w-[11px] text-left">
                {m ? <span className="inline-block -translate-x-1">{m}</span> : null}
              </div>
            ))}
          </div>

          <div className="flex gap-[3px]">
            {/* Days of the Week labels (English: M, W, F aligned) */}
            <div className="flex flex-col gap-[3px] pr-1 text-[9px] font-mono font-bold text-neutral-600">
              {["", "M", "", "W", "", "F", ""].map((lbl, i) => (
                <span key={i} className="h-[11px] leading-[11px] w-3 text-center">
                  {lbl}
                </span>
              ))}
            </div>

            {/* Grid Generation */}
            <div className="flex gap-[3px]">
              {Array.from({ length: monthLabels.length }, (_, w) => (
                <div key={w} className="flex flex-col gap-[3px]">
                  {Array.from({ length: 7 }, (_, d) => {
                    const cell = grid[d]?.[w];
                    if (!cell || cell.inFuture)
                      return <div key={d} className="w-[11px] h-[11px] bg-transparent" />;
                    return (
                      <div
                        key={d}
                        title={`${cell.count} card${cell.count !== 1 ? "s" : ""} on ${cell.date.toLocaleDateString("en-US")}`}
                        className={`w-[11px] h-[11px] rounded-[3px] border transition-colors duration-300 ${intensityClass(cell.count)}`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

    </section>
  );
}