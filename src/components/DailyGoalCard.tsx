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
      const start = `${date}T00:00:00`;
      const end = `${date}T23:59:59.999`;
      const { count } = await supabase
        .from("cards")
        .select("id", { count: "exact", head: true })
        .gte("created_at", start)
        .lte("created_at", end);
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
      .upsert(
        { user_id: user.id, date, target_count: n },
        { onConflict: "user_id,date" },
      );
    if (error) return toast.error(error.message);
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["daily_goal", date] });
    toast.success("Objectif mis à jour");
  }

  return (
    <div className="glass-panel p-5 md:p-6 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target size={18} className="text-[color:var(--color-gold)]" />
          <p className="label-mono">Objectif du jour</p>
        </div>
        {!editing ? (
          <button
            onClick={() => {
              setDraft(String(target));
              setEditing(true);
            }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition"
          >
            <Pencil size={12} /> Modifier
          </button>
        ) : (
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={500}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-16 glass-panel-soft text-xs px-2 py-1 rounded-md"
            />
            <button
              onClick={saveGoal}
              className="p-1.5 rounded-md bg-[color:var(--color-crimson)]/40 hover:bg-[color:var(--color-crimson)]/60"
            >
              <Check size={13} />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-3xl md:text-4xl font-bold text-[color:var(--color-gold)]">
          {generated}
        </span>
        <span className="text-lg text-muted-foreground">/ {target} mots</span>
      </div>

      <div className="h-2.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background:
              "linear-gradient(90deg, var(--color-crimson) 0%, var(--color-crimson-glow) 100%)",
          }}
        />
      </div>

      <p className="text-sm text-muted-foreground">
        {reached
          ? "🎉 Objectif atteint aujourd'hui !"
          : `Encore ${target - generated} mot${target - generated > 1 ? "s" : ""} pour atteindre ton objectif`}
      </p>
    </div>
  );
}
