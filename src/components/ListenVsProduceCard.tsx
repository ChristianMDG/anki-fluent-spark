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

const DAY_LABELS = ["L", "M", "M", "J", "V", "S", "D"];

export function ListenVsProduceCard() {
  const start = weekStart();
  const startIso = start.toISOString();

  const query = useQuery({
    queryKey: ["listen-vs-produce", startIso],
    queryFn: async () => {
      const [videos, recs] = await Promise.all([
        supabase
          .from("shadowing_videos")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .select("watch_duration_seconds,last_watched_at" as any)
          .gte("last_watched_at", startIso),
        supabase
          .from("fluency_recordings")
          .select("duration_seconds,created_at")
          .gte("created_at", startIso),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vRows = ((videos.data ?? []) as any[]).filter((r) => r.last_watched_at);
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
    <div className="glass-panel p-5 md:p-6 space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <p className="label-mono text-[color:var(--color-gold)]">Écoute vs Production</p>
          <h3 className="text-lg font-semibold mt-0.5">Cette semaine</h3>
        </div>
        <p className="text-sm text-muted-foreground font-mono">{fmtMin(total)} au total</p>
      </div>

      <div className="space-y-2">
        <div className="h-3 rounded-full overflow-hidden bg-white/5 flex">
          <div
            className="h-full transition-all"
            style={{ width: `${listenPct}%`, background: "#5b8def" }}
            title={`Écoute: ${fmtMin(data.totalListen)}`}
          />
          <div
            className="h-full transition-all"
            style={{
              width: `${producePct}%`,
              background: "var(--color-crimson)",
            }}
            title={`Production: ${fmtMin(data.totalProduce)}`}
          />
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#5b8def" }} />
            <Headphones size={12} /> Écoute {fmtMin(data.totalListen)}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-sm"
              style={{ background: "var(--color-crimson)" }}
            />
            <Mic size={12} /> Production {fmtMin(data.totalProduce)}
          </span>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{insight}</p>

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
                  className="w-full rounded-sm overflow-hidden bg-white/5 flex flex-col justify-end"
                  style={{ height: `${Math.max(heightPct, sum ? 8 : 4)}%` }}
                  title={`${fmtMin(d.listen)} écoute · ${fmtMin(d.produce)} production`}
                >
                  <div style={{ height: `${produceH}%`, background: "var(--color-crimson)" }} />
                  <div style={{ height: `${listenH}%`, background: "#5b8def" }} />
                </div>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground">{lbl}</span>
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
    return "Regarde une vidéo de shadowing ou lance une session Fluency pour lancer la semaine.";
  if (produce >= listen) return "Belle proportion de pratique active cette semaine !";
  const ratio = produce > 0 ? listen / produce : Infinity;
  if (ratio > 3)
    return "Tu écoutes beaucoup plus que tu ne parles cette semaine. Essaie d'ajouter quelques sessions Retell it ou Fluency Practice pour rééquilibrer.";
  return "Bon équilibre, continue sur cette lancée.";
}
