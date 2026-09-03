import { useEffect, useState } from "react";
import { Activity, Info, Loader2, Sparkles } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  analyzePitchContour,
  type PitchAnalysisResult,
} from "@/lib/pitch-analyzer";

export function PitchContourChart({ blob }: { blob: Blob | null }) {
  const [analysis, setAnalysis] = useState<PitchAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (!blob || blob.size === 0) {
      setAnalysis(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    analyzePitchContour(blob)
      .then((res) => {
        if (isMounted) {
          setAnalysis(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to analyze pitch.");
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [blob]);

  if (!blob) return null;

  return (
    <div className="glass-panel p-4 space-y-3 mt-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 label-mono text-[color:var(--color-gold)]">
          <Activity size={15} /> Intonation & Pitch Contour
        </div>
        {analysis && (
          <span className="text-[11px] font-mono text-muted-foreground">
            Range: ~{analysis.pitchRange} Hz
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 gap-2.5 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin text-[color:var(--color-crimson)]" />
          <span>Analyzing pitch contour…</span>
        </div>
      ) : error ? (
        <p className="text-xs text-muted-foreground italic py-2">{error}</p>
      ) : analysis ? (
        <div className="space-y-3">
          <div className="h-36 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={analysis.data}
                margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
              >
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis
                  dataKey="timeLabel"
                  tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={["auto", "auto"]}
                  unit="Hz"
                  tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 10 }}
                />
                <Tooltip
                  contentStyle={{
                    background: "rgba(15,15,20,0.95)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                  formatter={(value) => {
                    const num = typeof value === "number" ? value : null;
                    return num != null ? [`${num} Hz`, "Learner Pitch"] : ["Silence / Unvoiced", "Pitch"];
                  }}
                />
                <Line
                  connectNulls={false}
                  type="monotone"
                  dataKey="pitch"
                  name="Pitch (Hz)"
                  stroke="#dc2626"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={!prefersReducedMotion}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div
            className={`rounded-lg px-3.5 py-2.5 border text-xs flex items-center gap-2.5 ${
              analysis.isFlat
                ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            }`}
          >
            {analysis.isFlat ? (
              <Info size={16} className="shrink-0 text-amber-400" />
            ) : (
              <Sparkles size={16} className="shrink-0 text-emerald-400" />
            )}
            <span className="leading-snug">{analysis.hint}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
