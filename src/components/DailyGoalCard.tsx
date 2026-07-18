import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Target, Pencil, Check } from "lucide-react";

function today(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DailyGoalCard() {
  const qc = useQueryClient();
  const date = useMemo(today, []);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("10");

  const goal = useQuery({
    queryKey: ["daily_goal", date],
    queryFn: async () => {
      const { data } = await supabase
        .from("daily_goals")
        .select("target_count")
        .eq("date", date)
        .maybeSingle();
      return data?.target_count ?? 10;
    },
  });

  const count = useQuery({
    queryKey: ["daily_count", date],
    queryFn: async () => {
      const startLocal = new Date();
      startLocal.setHours(0, 0, 0, 0);
      const endLocal = new Date();
      endLocal.setHours(23, 59, 59, 999);
      const { count } = await supabase
        .from("cards")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startLocal.toISOString())
        .lte("created_at", endLocal.toISOString());
      return count ?? 0;
    },
    refetchOnWindowFocus: true,
  });

  const target = goal.data ?? 10;
  const generated = count.data ?? 0;
  const pct = Math.min(100, Math.round((generated / Math.max(target, 1)) * 100));
  const reached = generated >= target;

  async function saveGoal() {
    const n = Math.max(1, Math.min(500, parseInt(draft, 10) || 10));
    const user = (await supabase.auth.getUser()).data.user;
    if (!user) return;
    const { error } = await supabase
      .from("daily_goals")
      .upsert({ user_id: user.id, date, target_count: n }, { onConflict: "user_id,date" });
    if (error) return toast.error(error.message);
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["daily_goal", date] });
    toast.success("Objective updated successfully");
  }

  return (
    <div className="w-full flex flex-col justify-between h-full space-y-3 min-h-0 overflow-hidden">
      {/* Internal Header Grid */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <Target size={14} className="text-[var(--color-gold)] drop-shadow-[0_0_4px_rgba(212,175,55,0.4)]" />
          <h3 className="font-audiowide text-[10px] tracking-wider uppercase text-neutral-400">
            Operational Objective
          </h3>
        </div>
        
        {!editing ? (
          <button
            onClick={() => {
              setDraft(String(target));
              setEditing(true);
            }}
            className="font-audiowide flex items-center gap-1 text-[9px] uppercase tracking-widest text-neutral-500 hover:text-[var(--color-gold)] transition-colors duration-300"
          >
            <Pencil size={10} /> Configure
          </button>
        ) : (
          <div className="flex items-center gap-1.5 animate-fade-in">
            <input
              type="number"
              min={1}
              max={500}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-14 bg-black/60 border border border-[var(--color-border)]/60 text-white font-audiowide text-[10px] text-center px-1.5 py-0.5 rounded-md focus:outline-none focus:border-[var(--color-crimson)]"
            />
            <button
              onClick={saveGoal}
              className="p-1 rounded-md bg-[var(--color-crimson)]/20 hover:bg-[var(--color-crimson)] text-[var(--color-crimson)] hover:text-white border border-[var(--color-crimson)]/30 transition-all duration-300"
            >
              <Check size={11} />
            </button>
          </div>
        )}
      </div>

      {/* Primary Metrics Layer */}
      <div className="flex items-baseline gap-1.5 shrink-0">
        <span className="font-audiowide text-2xl md:text-3xl font-black text-white tracking-wide drop-shadow-[0_0_10px_rgba(255,255,255,0.05)]">
          {generated}
        </span>
        <span className="font-audiowide text-[10px] uppercase tracking-widest text-neutral-500">
          / {target} SECURED
        </span>
      </div>

      {/* HUD System Gauge */}
      <div className="w-full h-2 bg-black/60 rounded-full border border-white/5 p-[1px] overflow-hidden shrink-0">
        <div
          className="h-full bg-gradient-to-r from-[var(--color-crimson)] to-[var(--color-gold)] rounded-full transition-all duration-500 ease-out"
          style={{ 
            width: `${pct}%`,
            boxShadow: pct > 0 ? '0 0 8px var(--color-crimson)' : 'none'
          }}
        />
      </div>

      {/* Mission Status Strip */}
      <p className="font-audiowide text-[9px] uppercase tracking-[0.12em] shrink-0 text-neutral-400">
        {reached ? (
          <span className="text-[var(--color-gold)] drop-shadow-[0_0_6px_rgba(212,175,55,0.3)]">
            ✓ Mission Accomplished: Threshold Secured
          </span>
        ) : (
          <span>
            Analysis: <span className="text-[var(--color-crimson)]">{target - generated}</span> more word{target - generated > 1 ? "s" : ""} required
          </span>
        )}
      </p>
    </div>
  );
}