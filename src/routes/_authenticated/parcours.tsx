import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  JOURNEY_SITUATIONS,
  SITUATION_META,
  COMPLEXITY_META,
  type JourneySituation,
  type JourneyStatus,
} from "@/lib/journey";
import { Lock, Check, Play, X, Mic, History, Compass } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/parcours")({
  component: ParcoursPage,
});

type Cell = {
  id: string;
  situation: JourneySituation;
  complexity_level: number;
  sessions_completed: number;
  status: JourneyStatus;
};

const LEVELS = [1, 2, 3, 4, 5] as const;

function ParcoursPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Cell | null>(null);

  // Ensure cells exist for this user, then load
  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.rpc("ensure_journey_cells", { _user: user.id });
      qc.invalidateQueries({ queryKey: ["journey-cells"] });
    })();
  }, [qc]);

  const { data: cells = [] } = useQuery({
    queryKey: ["journey-cells"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("journey_cells")
        .select("id, situation, complexity_level, sessions_completed, status")
        .order("situation")
        .order("complexity_level");
      if (error) throw error;
      return (data ?? []) as Cell[];
    },
  });

  const byKey = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const c of cells) m.set(`${c.situation}:${c.complexity_level}`, c);
    return m;
  }, [cells]);

  const mastered = cells.filter((c) => c.status === "mastered").length;
  const inProgress = cells.filter((c) => c.status === "in_progress").length;
  const locked = cells.filter((c) => c.status === "locked").length;
  const pct = cells.length ? Math.round((mastered / 25) * 100) : 0;

  function openCell(cell: Cell) {
    if (cell.status === "locked") {
      setSelected(cell);
      return;
    }
    setSelected(cell);
  }

  function startSession(cell: Cell) {
    navigate({ to: "/fluency", search: { journeyCell: cell.id } });
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div>
        <p className="label-mono text-[color:var(--color-gold)] flex items-center gap-2">
          <Compass size={14} /> Parcours
        </p>
        <h1 className="text-3xl md:text-4xl font-bold mt-1">
          Devenir fluide dans chaque situation.
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          5 situations × 5 niveaux de complexité linguistique. Chaque cellule maîtrisée
          débloque la suivante à droite et en dessous.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Maîtrisées" value={mastered} accent />
        <Stat label="En cours" value={inProgress} />
        <Stat label="Verrouillées" value={locked} />
        <Stat label="Complétion" value={`${pct}%`} />
      </div>

      {/* Matrix */}
      <div className="glass-panel p-4 md:p-6 overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[160px_repeat(5,minmax(0,1fr))] gap-2 md:gap-3">
            <div />
            {LEVELS.map((lvl) => (
              <div key={lvl} className="text-center">
                <div className="label-mono text-[color:var(--color-gold)]">Niveau {lvl}</div>
                <div className="text-sm font-semibold">{COMPLEXITY_META[lvl].label}</div>
              </div>
            ))}

            {JOURNEY_SITUATIONS.map((sit) => (
              <FragmentRow
                key={sit}
                situation={sit}
                cells={LEVELS.map(
                  (lvl) => byKey.get(`${sit}:${lvl}`) ?? null,
                )}
                onOpen={openCell}
              />
            ))}
          </div>
        </div>
      </div>

      {selected && (
        <CellDetail
          cell={selected}
          onClose={() => setSelected(null)}
          onStart={() => startSession(selected)}
        />
      )}
    </div>
  );
}

function FragmentRow({
  situation,
  cells,
  onOpen,
}: {
  situation: JourneySituation;
  cells: (Cell | null)[];
  onOpen: (c: Cell) => void;
}) {
  const meta = SITUATION_META[situation];
  return (
    <>
      <div className="flex items-center gap-2 pr-2">
        <span className="text-xl">{meta.icon}</span>
        <div>
          <div className="text-sm font-semibold">{meta.label}</div>
        </div>
      </div>
      {cells.map((c, i) =>
        c ? (
          <MatrixCell key={c.id} cell={c} onClick={() => onOpen(c)} />
        ) : (
          <div
            key={i}
            className="rounded-lg bg-black/30 border border-[color:var(--color-border)] aspect-[4/3] flex items-center justify-center text-xs text-muted-foreground"
          >
            —
          </div>
        ),
      )}
    </>
  );
}

function MatrixCell({ cell, onClick }: { cell: Cell; onClick: () => void }) {
  const clickable = cell.status !== "locked";
  const base =
    "rounded-lg aspect-[4/3] flex flex-col items-center justify-center gap-1 p-2 text-center border transition text-sm";
  let cls = "";
  let icon: React.ReactNode = null;
  let text: React.ReactNode = null;

  if (cell.status === "locked") {
    cls = "bg-black/40 border-[color:var(--color-border)] text-muted-foreground opacity-70 cursor-help";
    icon = <Lock size={18} />;
    text = <span className="label-mono">Verrouillé</span>;
  } else if (cell.status === "available") {
    cls =
      "bg-white/5 border-[color:var(--color-border)] hover:-translate-y-0.5 hover:border-[color:var(--color-crimson-glow)] cursor-pointer";
    icon = <Play size={18} className="text-[color:var(--color-crimson-glow)]" />;
    text = <span className="font-semibold">Commencer</span>;
  } else if (cell.status === "in_progress") {
    cls =
      "bg-[color:var(--color-crimson)]/20 border-[color:var(--color-crimson-glow)] hover:-translate-y-0.5 cursor-pointer";
    icon = <Mic size={18} className="text-[color:var(--color-crimson-glow)]" />;
    text = <span className="font-mono text-base">{cell.sessions_completed}/5</span>;
  } else {
    // mastered
    cls =
      "bg-gradient-to-br from-[color:var(--color-crimson)]/30 to-[color:var(--color-gold)]/20 border-[color:var(--color-gold)] cursor-pointer hover:-translate-y-0.5";
    icon = <Check size={20} className="text-[color:var(--color-gold)]" />;
    text = <span className="label-mono text-[color:var(--color-gold)]">Maîtrisé</span>;
  }

  return (
    <button
      type="button"
      onClick={clickable || cell.status === "locked" ? onClick : undefined}
      className={`${base} ${cls}`}
      aria-label={`${cell.situation} niveau ${cell.complexity_level} — ${cell.status}`}
    >
      {icon}
      {text}
    </button>
  );
}

function CellDetail({
  cell,
  onClose,
  onStart,
}: {
  cell: Cell;
  onClose: () => void;
  onStart: () => void;
}) {
  const sit = SITUATION_META[cell.situation];
  const cx = COMPLEXITY_META[cell.complexity_level];
  const locked = cell.status === "locked";

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-3 md:p-6 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="glass-panel w-full max-w-lg p-6 space-y-4 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5"
          aria-label="Fermer"
        >
          <X size={16} />
        </button>

        <div>
          <p className="label-mono text-[color:var(--color-gold)]">
            {sit.icon} {sit.label} — {cx.label}
          </p>
          <h2 className="text-2xl font-bold mt-1">
            Niveau {cell.complexity_level} · {cx.label}
          </h2>
        </div>

        <p className="text-sm text-muted-foreground">{cx.description}</p>
        <p className="text-sm text-muted-foreground">{sit.description}</p>

        {locked ? (
          <div className="glass-panel-soft p-4 rounded-lg text-sm space-y-2">
            <p className="font-semibold flex items-center gap-2">
              <Lock size={14} /> Cellule verrouillée
            </p>
            <p className="text-muted-foreground">
              Maîtrise{" "}
              {cell.complexity_level > 1 && (
                <>
                  la cellule <b>{cx.label}</b> précédente sur la même ligne
                </>
              )}
              {cell.complexity_level > 1 &&
                JOURNEY_SITUATIONS.indexOf(cell.situation) > 0 &&
                " et "}
              {JOURNEY_SITUATIONS.indexOf(cell.situation) > 0 && (
                <>
                  la même colonne dans <b>
                    {
                      SITUATION_META[
                        JOURNEY_SITUATIONS[
                          JOURNEY_SITUATIONS.indexOf(cell.situation) - 1
                        ]
                      ].label
                    }
                  </b>
                </>
              )}
              {" "}pour débloquer.
            </p>
          </div>
        ) : (
          <>
            <div>
              <div className="flex justify-between label-mono mb-1">
                <span>Progression</span>
                <span>{cell.sessions_completed} / 5</span>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[color:var(--color-crimson)] to-[color:var(--color-crimson-glow)] transition-all"
                  style={{ width: `${Math.min(100, (cell.sessions_completed / 5) * 100)}%` }}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                onClick={onStart}
                className="btn-crimson rounded-lg px-5 py-2.5 flex items-center gap-2"
              >
                <Mic size={16} /> Commencer une session
              </button>
              <button
                onClick={() => {
                  toast.info(
                    "Filtre à venir dans le journal — les sessions du Parcours sont enregistrées avec la cellule associée.",
                  );
                }}
                className="rounded-lg px-5 py-2.5 border border-[color:var(--color-border)] hover:bg-white/5 flex items-center gap-2 text-sm"
              >
                <History size={14} /> Historique
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <div className="glass-panel p-4">
      <div
        className={`text-2xl font-bold ${accent ? "text-[color:var(--color-gold)]" : ""}`}
      >
        {value}
      </div>
      <div className="label-mono mt-1">{label}</div>
    </div>
  );
}
