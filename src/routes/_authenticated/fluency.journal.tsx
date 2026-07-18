import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

export const Route = createFileRoute("/_authenticated/fluency/journal")({
  component: FluencyJournal,
});

type Row = {
  id: string;
  session_id: string | null;
  exercise_type: string;
  prompt_text: string;
  week_theme: string;
  storage_path: string | null;
  duration_seconds: number;
  fluency_rating: number | null;
  confidence_rating: number | null;
  hesitation_rating: number | null;
  pinned: boolean;
  created_at: string;
};

function FluencyJournal() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const { data: rows = [] } = useQuery({
    queryKey: ["fluency-journal", typeFilter, from, to],
    queryFn: async () => {
      let q = supabase
        .from("fluency_recordings")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (typeFilter !== "all") q = q.eq("exercise_type", typeFilter);
      if (from) q = q.gte("created_at", new Date(from).toISOString());
      if (to) {
        const end = new Date(to);
        end.setDate(end.getDate() + 1);
        q = q.lt("created_at", end.toISOString());
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data as Row[]) ?? [];
    },
  });

  const pinned = useMemo(() => rows.filter((r) => r.pinned), [rows]);
  const grouped = useMemo(() => groupByDay(rows), [rows]);
  const trend = useMemo(() => buildWeeklyTrend(rows), [rows]);

  async function togglePin(r: Row) {
    const next = !r.pinned;
    const { error } = await supabase
      .from("fluency_recordings")
      .update({ pinned: next })
      .eq("id", r.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["fluency-journal"] });
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="label-mono text-[color:var(--color-gold)]">Fluency Practice</p>
          <h1 className="text-3xl font-bold mt-1">Fluency Journal</h1>
        </div>
        <Link
          to="/fluency"
          className="rounded-lg px-4 py-2.5 border border-[color:var(--color-border)] hover:bg-white/5 flex items-center gap-2 text-sm"
        >
          <ArrowLeft size={16} /> Back to module
        </Link>
      </div>

      <div className="glass-panel p-5">
        <p className="label-mono mb-3">3-Month Trend (weekly averages)</p>
        {trend.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Not enough data yet. Record a few sessions to see your progress.
          </p>
        ) : (
          <div className="h-64 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="week" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} />
                <YAxis domain={[1, 5]} tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: "rgba(15,15,20,0.95)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="fluency"
                  name="Fluency"
                  stroke="#dc2626"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="confidence"
                  name="Confidence"
                  stroke="#eab308"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="hesitation"
                  name="Hesitations"
                  stroke="#94a3b8"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="glass-panel-soft p-4 rounded-xl flex flex-wrap gap-3 items-end">
        <div>
          <label className="label-mono block mb-1">Type</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-black/40 border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All</option>
            <option value="free_talk">Free Talk</option>
            <option value="chunk_repeat">Chunk Repeat</option>
            <option value="dialogue">Dialogue</option>
            <option value="retell">🔁 Retell</option>
          </select>
        </div>
        <div>
          <label className="label-mono block mb-1">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="bg-black/40 border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="label-mono block mb-1">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="bg-black/40 border border-[color:var(--color-border)] rounded-lg px-3 py-2 text-sm"
          />
        </div>
      </div>

      {pinned.length > 0 && (
        <section className="space-y-3">
          <h2 className="label-mono text-[color:var(--color-gold)]">📌 Pinned</h2>
          <div className="grid gap-3">
            {pinned.map((r) => (
              <RecordingCard key={r.id} row={r} onTogglePin={togglePin} />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        {grouped.length === 0 ? (
          <div className="glass-panel p-8 text-center text-muted-foreground">
            No recordings found for these filters.
          </div>
        ) : (
          grouped.map(([day, list]) => (
            <div key={day} className="space-y-2">
              <h3 className="label-mono">{formatDay(day)}</h3>
              <div className="grid gap-3">
                {list.map((r) => (
                  <RecordingCard key={r.id} row={r} onTogglePin={togglePin} />
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function RecordingCard({ row, onTogglePin }: { row: Row; onTogglePin: (r: Row) => void }) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadAudio() {
    if (!row.storage_path || audioUrl) return;
    setLoading(true);
    const { data, error } = await supabase.storage
      .from("fluency-recordings")
      .createSignedUrl(row.storage_path, 3600);
    setLoading(false);
    if (error) return toast.error(error.message);
    setAudioUrl(data.signedUrl);
  }

  const expired = !row.storage_path;

  return (
    <div className="glass-panel p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="label-mono text-[color:var(--color-gold)]">
              {labelType(row.exercise_type)}
            </span>
            {row.week_theme && (
              <span className="label-mono text-muted-foreground">· {row.week_theme}</span>
            )}
          </div>
          <p className="text-sm mt-1 line-clamp-2">{row.prompt_text}</p>
        </div>
        <button
          onClick={() => onTogglePin(row)}
          className={`p-2 rounded-lg transition ${
            row.pinned
              ? "text-[color:var(--color-gold)] hover:bg-white/5"
              : "text-muted-foreground hover:text-foreground hover:bg-white/5"
          }`}
          title={row.pinned ? "Unpin" : "Pin"}
        >
          {row.pinned ? <Pin size={16} /> : <PinOff size={16} />}
        </button>
      </div>

      {expired ? (
        <p className="text-xs text-muted-foreground italic">Recording expired (90 days)</p>
      ) : audioUrl ? (
        <audio src={audioUrl} controls className="w-full h-9" />
      ) : (
        <button
          onClick={loadAudio}
          disabled={loading}
          className="text-xs rounded-lg px-3 py-1.5 border border-[color:var(--color-border)] hover:bg-white/5"
        >
          {loading ? "Loading..." : "▶ Listen"}
        </button>
      )}

      <div className="flex gap-2 flex-wrap pt-1">
        <RatingBar label="Fluency" value={row.fluency_rating} color="#dc2626" />
        <RatingBar label="Confidence" value={row.confidence_rating} color="#eab308" />
        <RatingBar label="Hesitations" value={row.hesitation_rating} color="#94a3b8" />
      </div>
    </div>
  );
}

function RatingBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number | null;
  color: string;
}) {
  const pct = value ? (value / 5) * 100 : 0;
  return (
    <div className="flex-1 min-w-[100px]">
      <div className="flex justify-between items-center text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
        <span>{label}</span>
        <span>{value ?? "–"}/5</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function labelType(t: string) {
  if (t === "retell") return "🔁 Retell";
  return t === "free_talk" ? "Free Talk" : t === "chunk_repeat" ? "Chunk Repeat" : "Dialogue";
}

function groupByDay(rows: Row[]): [string, Row[]][] {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    // Bucket by LOCAL calendar day, not UTC. `.toISOString().slice(0, 10)`
    // reads the UTC date, which mis-files any recording made in the first
    // few hours after local midnight into the previous day for users ahead
    // of UTC (e.g. UTC+3 in Antananarivo) — a late-night Retell it session
    // could silently show up under yesterday's heading.
    const d = new Date(r.created_at);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(r);
  }
  return Array.from(map.entries());
}

function formatDay(d: string) {
  // `d` is a local "YYYY-MM-DD" key built above. Parse it as local
  // components (not `new Date(d)`, which treats a bare date string as UTC
  // midnight and would shift the displayed weekday for the same reason).
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function buildWeeklyTrend(rows: Row[]) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const filtered = rows.filter((r) => new Date(r.created_at) >= cutoff);
  const buckets = new Map<string, { f: number; c: number; h: number; n: number; ts: number }>();
  for (const r of filtered) {
    const d = new Date(r.created_at);
    const key = weekKey(d);
    const b = buckets.get(key) ?? { f: 0, c: 0, h: 0, n: 0, ts: d.getTime() };
    if (r.fluency_rating != null) b.f += r.fluency_rating;
    if (r.confidence_rating != null) b.c += r.confidence_rating;
    if (r.hesitation_rating != null) b.h += r.hesitation_rating;
    b.n += 1;
    buckets.set(key, b);
  }
  return Array.from(buckets.entries())
    .map(([week, b]) => ({
      week,
      ts: b.ts,
      fluency: b.n ? +(b.f / b.n).toFixed(2) : 0,
      confidence: b.n ? +(b.c / b.n).toFixed(2) : 0,
      hesitation: b.n ? +(b.h / b.n).toFixed(2) : 0,
    }))
    .sort((a, b) => a.ts - b.ts);
}

function weekKey(d: Date) {
  const monday = new Date(d);
  const day = monday.getDay() || 7;
  monday.setDate(monday.getDate() - day + 1);
  return monday.toLocaleDateString("en-US", { day: "2-digit", month: "2-digit" });
}
