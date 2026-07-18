import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { Mic, Square, RotateCcw, X, ChevronRight } from "lucide-react";
import { toast } from "sonner";

interface Note {
  id: string;
  word: string;
}
interface Props {
  open: boolean;
  video: {
    id: string;
    title: string;
    thumbnail_url: string;
  } | null;
  watchedSeconds: number;
  notes: Note[];
  onClose: () => void;
  onSkip: () => void; // increments skipped counter
  onSaved: () => void;
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function RetellItModal({ open, video, watchedSeconds, notes, onClose, onSkip, onSaved }: Props) {
  const suggested = Math.max(30, Math.min(90, Math.round(watchedSeconds * 0.1)));

  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<{ blob: Blob; url: string; durationSec: number } | null>(null);
  const [ratings, setRatings] = useState({ fluency: 3, confidence: 3, hesitation: 3 });
  const [saving, setSaving] = useState(false);

  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!open) {
      // reset
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (result) URL.revokeObjectURL(result.url);
      setResult(null);
      setElapsed(0);
      setRecording(false);
      setRecorder(null);
      setRatings({ fluency: 3, confidence: 3, hesitation: 3 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function startRecording() {
    if (typeof MediaRecorder === "undefined") {
      toast.error("Your browser does not support audio recording.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime || "audio/webm" });
        const url = URL.createObjectURL(blob);
        const durationSec = Math.round((Date.now() - startTsRef.current) / 1000);
        setResult({ blob, url, durationSec });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      };
      rec.start();
      setRecorder(rec);
      setRecording(true);
      setElapsed(0);
      startTsRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Math.round((Date.now() - startTsRef.current) / 1000));
      }, 250);
    } catch {
      toast.error("Microphone access denied. Please allow microphone access in your browser settings.");
    }
  }

  function stopRecording() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setRecording(false);
  }

  function retry() {
    if (result) URL.revokeObjectURL(result.url);
    setResult(null);
    setElapsed(0);
  }

  async function save() {
    if (!result || !video) return;
    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // create session tagged as retell + link to video
      const { data: sess, error: sessErr } = await supabase
        .from("fluency_sessions")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert({
          user_id: user.id,
          session_length: "quick",
          week_theme: "Retell it",
          source_video_id: video.id,
          completed_at: new Date().toISOString(),
        } as never)
        .select()
        .single();
      if (sessErr) throw sessErr;

      const path = `${user.id}/${sess!.id}/${crypto.randomUUID()}.webm`;
      const { error: upErr } = await supabase.storage
        .from("fluency-recordings")
        .upload(path, result.blob, { contentType: result.blob.type });
      if (upErr) throw upErr;

      const { error: recErr } = await supabase.from("fluency_recordings").insert({
        user_id: user.id,
        session_id: sess!.id,
        exercise_type: "retell",
        prompt_text: `Retell: ${video.title || "video"}`,
        week_theme: "Retell it",
        storage_path: path,
        duration_seconds: result.durationSec,
        fluency_rating: ratings.fluency,
        confidence_rating: ratings.confidence,
        hesitation_rating: ratings.hesitation,
      });
      if (recErr) throw recErr;

      toast.success("Retell saved — well done!");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (!open || !video || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="glass-panel max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 md:p-8 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="label-mono text-[color:var(--color-gold)]">🔁 Retell it</p>
            <h2 className="text-2xl font-bold mt-1">Tell what you just saw</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-3 items-center glass-panel-soft rounded-lg p-3">
          {video.thumbnail_url ? (
            <img src={video.thumbnail_url} alt="" className="w-24 aspect-video object-cover rounded" />
          ) : (
            <div className="w-24 aspect-video bg-black/50 rounded flex items-center justify-center text-xs text-muted-foreground">
              video
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm truncate">{video.title || "Untitled video"}</p>
            <p className="label-mono mt-1">Watched: {formatTime(watchedSeconds)}</p>
          </div>
        </div>

        {notes.length > 0 && (
          <div>
            <p className="label-mono mb-2">Words noted during this session</p>
            <div className="flex gap-1.5 flex-wrap">
              {notes.map((n) => (
                <span
                  key={n.id}
                  className="text-xs px-2 py-1 rounded-full bg-[color:var(--color-crimson)]/20 border border-[color:var(--color-crimson)]/40"
                >
                  {n.word}
                </span>
              ))}
            </div>
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          Tell in English, in your own words, what you just saw. No need to be
          perfect — try to use at least one of the words above.
        </p>

        {!result ? (
          <div className="glass-panel-soft rounded-lg p-6 flex flex-col items-center gap-4">
            <button
              onClick={recording ? stopRecording : startRecording}
              className={`relative h-24 w-24 rounded-full flex items-center justify-center transition ${
                recording
                  ? "bg-[color:var(--color-crimson)] text-white"
                  : "bg-[color:var(--color-crimson)]/80 hover:bg-[color:var(--color-crimson)] text-white"
              }`}
              aria-label={recording ? "Stop" : "Start"}
            >
              {recording && (
                <span className="absolute inset-0 rounded-full bg-[color:var(--color-crimson)] opacity-60 motion-safe:animate-ping" />
              )}
              <span className="relative z-10">
                {recording ? <Square size={30} /> : <Mic size={30} />}
              </span>
            </button>
            <div className="text-center">
              <div className="text-2xl font-mono font-bold">
                {formatTime(elapsed)}
                <span className="text-muted-foreground text-sm"> · target {formatTime(suggested)}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {recording ? "Recording…" : "Press to start"}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="glass-panel-soft rounded-lg p-4 space-y-3">
              <p className="label-mono">Your take ({formatTime(result.durationSec)})</p>
              <audio src={result.url} controls className="w-full" />
              <button
                onClick={retry}
                className="rounded-lg px-3 py-1.5 border border-[color:var(--color-border)] hover:bg-white/5 text-xs flex items-center gap-1.5"
              >
                <RotateCcw size={12} /> Retry
              </button>
            </div>

            <div className="glass-panel-soft rounded-lg p-4 space-y-3">
              <p className="label-mono">Self-evaluation</p>
              {(
                [
                  ["fluency", "Fluency", "hesitant", "fluent"],
                  ["confidence", "Confidence", "uncomfortable", "confident"],
                  ["hesitation", "Hesitations", "many pauses", "almost none"],
                ] as const
              ).map(([k, label, lo, hi]) => (
                <div key={k}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm">{label}</span>
                    <span className="text-sm font-mono text-[color:var(--color-gold)]">
                      {ratings[k]}/5
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    value={ratings[k]}
                    onChange={(e) => setRatings((r) => ({ ...r, [k]: Number(e.target.value) }))}
                    className="fluency-slider w-full"
                  />
                  <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                    <span>{lo}</span>
                    <span>{hi}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            onClick={() => {
              onSkip();
              onClose();
            }}
            className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
          >
            Skip this step
          </button>
          {result && (
            <button
              onClick={save}
              disabled={saving}
              className="btn-crimson rounded-lg px-5 py-2.5 disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? "Saving…" : "Save"} <ChevronRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
