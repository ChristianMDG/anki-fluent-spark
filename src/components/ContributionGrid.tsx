import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Flame } from "lucide-react";
import { useMemo } from "react";

const WEEKS = 17; // ~4 months
const DAYS = WEEKS * 7;

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function intensityClass(n: number) {
  if (n === 0) return "bg-white/[0.04] border-white/[0.03]";
  if (n <= 2) return "bg-[color:var(--color-crimson)]/25 border-[color:var(--color-crimson)]/30";
  if (n <= 5) return "bg-[color:var(--color-crimson)]/55 border-[color:var(--color-crimson)]/50";
  return "bg-[color:var(--color-crimson)] border-[color:var(--color-crimson-glow)] shadow-[0_0_6px_var(--color-crimson-glow)]";
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
    // Build days from oldest to newest ending today.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Align end to Saturday-of-current-week for a clean rightmost column
    const startDate = new Date(today);
    // start at (DAYS-1) days before, then push back to Sunday
    startDate.setDate(startDate.getDate() - (DAYS - 1));
    const startDow = startDate.getDay(); // 0=Sun
    startDate.setDate(startDate.getDate() - startDow);

    const totalDays = Math.ceil((today.getTime() - startDate.getTime()) / 86400000) + 1;
    const weeks = Math.ceil((totalDays + startDate.getDay()) / 7);

    // grid[dow][week]
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
          monthLabels.push(date.toLocaleDateString("fr-FR", { month: "short" }));
          labeled = true;
        }
      }
      if (!labeled) monthLabels.push(null);
    }

    // Streak calc: walk back from today
    let cur = 0;
    const cursor = new Date(today);
    while ((counts.get(ymd(cursor)) ?? 0) > 0) {
      cur += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    // If nothing today, current streak = 0 but we check "was active yesterday"
    // Best streak (over all days we have)
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
    <section className="glass-panel p-5 md:p-6">
      <div className="flex items-end justify-between flex-wrap gap-3 mb-4">
        <div>
          <p className="label-mono text-[color:var(--color-gold)]">Activité</p>
          <div className="flex items-baseline gap-3 mt-1">
            <h2 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
              <Flame size={22} className="text-[color:var(--color-crimson-glow)]" />
              {currentStreak} jour{currentStreak > 1 ? "s" : ""} de suite
            </h2>
            <span className="text-xs text-muted-foreground">Record : {bestStreak} j</span>
          </div>
          {todayCount === 0 && currentStreak === 0 && bestStreak > 0 && (
            <p className="text-xs text-amber-300/80 mt-1.5">
              Génère un mot aujourd'hui pour garder ton streak !
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>Moins</span>
          {[0, 1, 4, 8].map((n) => (
            <span
              key={n}
              className={`inline-block w-2.5 h-2.5 rounded-[3px] border ${intensityClass(n)}`}
            />
          ))}
          <span>Plus</span>
        </div>
      </div>

      <div className="overflow-x-auto -mx-2 px-2 pb-1">
        <div className="min-w-fit">
          <div className="flex gap-[3px] pl-6 mb-1 text-[10px] text-muted-foreground">
            {monthLabels.map((m, i) => (
              <div key={i} className="w-[11px] text-left">
                {m ? <span className="inline-block -translate-x-1">{m}</span> : null}
              </div>
            ))}
          </div>
          <div className="flex gap-[3px]">
            <div className="flex flex-col gap-[3px] pr-1 text-[9px] text-muted-foreground">
              {/* Row indices: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat.
                  Label only Mon/Wed/Fri, each on its own 11px row so it lines
                  up with the matching row in the grid below (previously these
                  3 labels were spread with justify-between over the full
                  height, which visually mismatched them against the actual
                  Sun-first rows). */}
              {["", "L", "", "M", "", "V", ""].map((lbl, i) => (
                <span key={i} className="h-[11px] leading-[11px]">
                  {lbl}
                </span>
              ))}
            </div>
            <div className="flex gap-[3px]">
              {Array.from({ length: monthLabels.length }, (_, w) => (
                <div key={w} className="flex flex-col gap-[3px]">
                  {Array.from({ length: 7 }, (_, d) => {
                    const cell = grid[d]?.[w];
                    if (!cell || cell.inFuture)
                      return <div key={d} className="w-[11px] h-[11px]" />;
                    return (
                      <div
                        key={d}
                        title={`${cell.count} fiche${cell.count > 1 ? "s" : ""} le ${cell.date.toLocaleDateString("fr-FR")}`}
                        className={`w-[11px] h-[11px] rounded-[3px] border ${intensityClass(cell.count)}`}
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
