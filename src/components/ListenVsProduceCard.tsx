import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Headphones, Mic } from "lucide-react";

function weekStart(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay() || 7; // Sun=0 => 7
  x.setDate(x.getDate() - day + 1);
  return x;
}

function fmtMin(seconds: number) {
  const m = Math.round(seconds / 60);
  return `${m} min`;
}

// English day labels
const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

export function ListenVsProduceCard() {
  const start = weekStart();
  const startIso = start.toISOString();

  const query = useQuery({
    queryKey: ["listen-vs-produce", startIso],
    queryFn: async () => {
      const [videos, recs] = await Promise.all([
        supabase
          .from("shadowing_videos")
          .select("watch_duration_seconds,last_watched_at")
          .gte("last_watched_at", startIso),
        supabase
          .from("fluency_recordings")
          .select("duration_seconds,created_at")
          .gte("created_at", startIso),
      ]);
      const vRows = (videos.data ?? []).filter((r) => r.last_watched_at);
      const rRows = recs.data ?? [];

      const perDay: { listen: number; produce: number }[] = Array.from({ length: 7 }, () => ({
        listen: 0,
        produce: 0,
      }));

      let totalListen = 0;
      let totalProduce = 0;

      for (const v of vRows) {
        const day = dayIndex(new Date(v.last_watched_at as string), start);
        if (day < 0 || day > 6) continue;
        const s = Number(v.watch_duration_seconds) || 0;
        perDay[day].listen += s;
        totalListen += s;
      }
      for (const r of rRows) {
        const day = dayIndex(new Date(r.created_at), start);
        if (day < 0 || day > 6) continue;
        const s = Number(r.duration_seconds) || 0;
        perDay[day].produce += s;
        totalProduce += s;
      }
      return { totalListen, totalProduce, perDay };
    },
    staleTime: 30_000,
  });

  const data = query.data ?? { totalListen: 0, totalProduce: 0, perDay: [] };
  const total = data.totalListen + data.totalProduce;
  const listenPct = total ? (data.totalListen / total) * 100 : 0;
  const producePct = total ? (data.totalProduce / total) * 100 : 0;

  const insight = getInsight(data.totalListen, data.totalProduce);

  const maxDay = Math.max(1, ...data.perDay.map((d) => d.listen + d.produce));

  return (
    /* Couleur du container principal modifiée pour correspondre au style Cyber-Militant d'Akatsuki */
    <div className="p-5 md:p-6 space-y-4 bg-gradient-to-br from-[#120403]/60 via-[#0d0605]/40 to-black/60 backdrop-blur-md border border-[var(--color-border)]/40 rounded-2xl shadow-xl w-full flex flex-col justify-between h-full min-h-0 overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <p className="font-audiowide text-[11px] tracking-wider uppercase text-[var(--color-gold)]">Listening vs Production</p>
          <h3 className="text-lg font-semibold mt-0.5 text-white">This Week</h3>
        </div>
        <p className="text-sm text-neutral-400 font-mono">{fmtMin(total)} total</p>
      </div>

      <div className="space-y-2">
        <div className="h-3 rounded-full overflow-hidden bg-neutral-950/80 border border-white/5 flex">
          <div
            className="h-full transition-all duration-500 ease-out shadow-[0_0_8px_rgba(91,141,239,0.3)]"
            style={{ width: `${listenPct}%`, background: "#5b8def" }}
            title={`Listening: ${fmtMin(data.totalListen)}`}
          />
          <div
            className="h-full transition-all duration-500 ease-out shadow-[0_0_8px_var(--color-crimson)]"
            style={{
              width: `${producePct}%`,
              background: "var(--color-crimson)",
            }}
            title={`Production: ${fmtMin(data.totalProduce)}`}
          />
        </div>
        <div className="flex items-center gap-4 text-xs text-neutral-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#5b8def" }} />
            <Headphones size={12} className="text-[#5b8def]" /> Listening {fmtMin(data.totalListen)}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-sm"
              style={{ background: "var(--color-crimson)" }}
            />
            <Mic size={12} className="text-[var(--color-crimson)]" /> Production {fmtMin(data.totalProduce)}
          </span>
        </div>
      </div>

      <p className="text-sm text-neutral-400">{insight}</p>

      <div className="grid grid-cols-7 gap-2 pt-2">
        {DAY_LABELS.map((lbl, i) => {
          const d = data.perDay[i] ?? { listen: 0, produce: 0 };
          const sum = d.listen + d.produce;
          const heightPct = (sum / maxDay) * 100;
          const listenH = sum ? (d.listen / sum) * 100 : 0;
          const produceH = sum ? (d.produce / sum) * 100 : 0;
          return (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="h-16 w-full flex items-end">
                <div
                  className="w-full rounded-sm overflow-hidden bg-neutral-950/60 border border-white/5 flex flex-col justify-end"
                  style={{ height: `${Math.max(heightPct, sum ? 8 : 4)}%` }}
                  title={`${fmtMin(d.listen)} listening · ${fmtMin(d.produce)} production`}
                >
                  <div style={{ height: `${produceH}%`, background: "var(--color-crimson)" }} />
                  <div style={{ height: `${listenH}%`, background: "#5b8def" }} />
                </div>
              </div>
              <span className="text-[10px] font-mono text-neutral-500 font-bold">{lbl}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function dayIndex(date: Date, start: Date): number {
  const ms = date.getTime() - start.getTime();
  return Math.floor(ms / 86400000);
}

function getInsight(listen: number, produce: number): string {
  if (listen === 0 && produce === 0)
    return "Watch a shadowing video or start a Fluency session to kick off the week.";
  if (produce >= listen) return "Great proportion of active practice this week!";
  const ratio = produce > 0 ? listen / produce : Infinity;
  if (ratio > 3)
    return "You are listening much more than talking. Try adding Retell it or Fluency Practice sessions to balance it out.";
  return "Good balance, keep up the momentum.";
}