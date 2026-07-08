import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { generateVocabCard } from "@/lib/vocab.functions";
import { toast } from "sonner";
import {
  Youtube, Upload, Rewind, FastForward, Play, Pause, Zap, X, Check, Plus, Trash2,
  CheckCircle2, Info,
} from "lucide-react";
import { confirmDialog } from "@/components/ConfirmDialog";
import { RetellItModal } from "@/components/RetellItModal";

export const Route = createFileRoute("/_authenticated/shadowing")({
  component: ShadowingPage,
});

const SKIP_BANNER_KEY = "retell-skip-banner-dismissed-at";

interface VideoRow {
  id: string;
  source_type: "youtube" | "upload";
  youtube_id: string | null;
  storage_path: string | null;
  title: string;
  thumbnail_url: string;
  created_at: string;
}

interface NoteRow {
  id: string;
  word: string;
  context: string | null;
  card_id: string | null;
  video_id: string;
}

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
    /^([A-Za-z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function ShadowingPage() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"youtube" | "upload">("youtube");
  const [ytUrl, setYtUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [currentVideo, setCurrentVideo] = useState<VideoRow | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytPlayerRef = useRef<HTMLIFrameElement>(null);

  const videos = useQuery({
    queryKey: ["shadowing_videos", "list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shadowing_videos")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return data as VideoRow[];
    },
  });

  async function loadYoutube() {
    const id = extractYouTubeId(ytUrl.trim());
    if (!id) return toast.error("Invalid YouTube URL");
    let title = "";
    let thumbnail_url = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
      );
      if (res.ok) {
        const j = (await res.json()) as { title: string; thumbnail_url: string };
        title = j.title;
        thumbnail_url = j.thumbnail_url || thumbnail_url;
      }
    } catch {
      /* ignore */
    }
    const { data, error } = await supabase
      .from("shadowing_videos")
      .insert({
        source_type: "youtube",
        youtube_id: id,
        title,
        thumbnail_url,
        user_id: (await supabase.auth.getUser()).data.user!.id,
      })
      .select()
      .single();
    if (error) return toast.error(error.message);
    setCurrentVideo(data as VideoRow);
    setUploadedUrl(null);
    setYtUrl("");
    qc.invalidateQueries({ queryKey: ["shadowing_videos"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  }

  async function handleUpload(file: File) {
    if (file.size > 200 * 1024 * 1024) return toast.error("File too large (200 MB max)");
    setUploading(true);
    try {
      const user = (await supabase.auth.getUser()).data.user!;
      const path = `${user.id}/${crypto.randomUUID()}-${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from("shadowing-videos").upload(path, file);
      if (upErr) throw upErr;
      const { data, error } = await supabase
        .from("shadowing_videos")
        .insert({
          source_type: "upload",
          storage_path: path,
          title: file.name,
          thumbnail_url: "",
          user_id: user.id,
        })
        .select()
        .single();
      if (error) throw error;
      setCurrentVideo(data as VideoRow);
      const signed = await supabase.storage.from("shadowing-videos").createSignedUrl(path, 3600 * 4);
      setUploadedUrl(signed.data?.signedUrl ?? null);
      qc.invalidateQueries({ queryKey: ["shadowing_videos"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      toast.success("Video imported");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function loadFromHistory(v: VideoRow) {
    setCurrentVideo(v);
    if (v.source_type === "upload" && v.storage_path) {
      const signed = await supabase.storage
        .from("shadowing-videos")
        .createSignedUrl(v.storage_path, 3600 * 4);
      setUploadedUrl(signed.data?.signedUrl ?? null);
    } else {
      setUploadedUrl(null);
    }
  }

  async function deleteVideo(v: VideoRow, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const ok = await confirmDialog({
      title: "Delete this video?",
      description: `"${v.title || "Untitled"}" and all its notes will be permanently removed.`,
      confirmLabel: "Delete video",
    });
    if (!ok) return;
    if (v.source_type === "upload" && v.storage_path) {
      await supabase.storage.from("shadowing-videos").remove([v.storage_path]);
    }
    await supabase.from("shadowing_notes").delete().eq("video_id", v.id);
    const { error } = await supabase.from("shadowing_videos").delete().eq("id", v.id);
    if (error) return toast.error(error.message);
    if (currentVideo?.id === v.id) {
      setCurrentVideo(null);
      setUploadedUrl(null);
    }
    qc.invalidateQueries({ queryKey: ["shadowing_videos"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
    toast.success("Video deleted");
  }

  function seek(delta: number) {
    if (currentVideo?.source_type === "upload" && videoRef.current) {
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + delta);
    } else if (ytPlayerRef.current?.contentWindow) {
      ytPlayerRef.current.contentWindow.postMessage(
        JSON.stringify({
          event: "command",
          func: delta > 0 ? "seekTo" : "seekTo",
          args: [Math.max(0, (window as unknown as { __ytTime?: number }).__ytTime ?? 0) + delta, true],
        }),
        "*",
      );
    }
  }

  function playPause() {
    if (currentVideo?.source_type === "upload" && videoRef.current) {
      if (videoRef.current.paused) videoRef.current.play();
      else videoRef.current.pause();
    } else if (ytPlayerRef.current?.contentWindow) {
      ytPlayerRef.current.contentWindow.postMessage(
        JSON.stringify({ event: "command", func: "pauseVideo", args: [] }),
        "*",
      );
    }
  }

  return (
    <div className="max-w-[1280px] mx-auto space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="label-mono text-[color:var(--color-gold)]">Shadowing</p>
          <h1 className="text-3xl font-bold mt-1">Train your ear and your mouth</h1>
        </div>
        <Link
          to="/history"
          className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
        >
          View full history →
        </Link>
      </div>

      <div className="grid lg:grid-cols-[1fr_380px] gap-6">
        {/* Video column */}
        <div className="space-y-4">
          <div className="glass-panel p-4">
            <div className="flex gap-1 mb-3 p-1 bg-black/30 rounded-lg w-fit">
              <button
                onClick={() => setMode("youtube")}
                className={`px-3 py-1.5 rounded text-sm flex items-center gap-1.5 ${
                  mode === "youtube" ? "bg-[color:var(--color-crimson)]/40" : ""
                }`}
              >
                <Youtube size={14} /> YouTube link
              </button>
              <button
                onClick={() => setMode("upload")}
                className={`px-3 py-1.5 rounded text-sm flex items-center gap-1.5 ${
                  mode === "upload" ? "bg-[color:var(--color-crimson)]/40" : ""
                }`}
              >
                <Upload size={14} /> Upload
              </button>
            </div>

            {mode === "youtube" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  loadYoutube();
                }}
                className="flex gap-2"
              >
                <input
                  value={ytUrl}
                  onChange={(e) => setYtUrl(e.target.value)}
                  placeholder="https://youtube.com/watch?v=…"
                  className="flex-1 glass-panel-soft px-3 py-2 rounded-lg text-sm"
                />
                <button className="btn-crimson rounded-lg px-4 py-2 text-sm">Load</button>
              </form>
            ) : (
              <label className="block glass-panel-soft border-dashed border-2 border-[color:var(--color-border)] rounded-lg p-6 text-center cursor-pointer hover:border-[color:var(--color-crimson-glow)] transition">
                <input
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime,.mov"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUpload(f);
                  }}
                />
                <Upload className="mx-auto mb-2 text-[color:var(--color-gold)]" size={28} />
                <p className="text-sm">
                  {uploading ? "Uploading…" : "Drop a video or click to browse"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">.mp4, .webm, .mov — max 200 Mo</p>
              </label>
            )}
          </div>

          {currentVideo && (
            <div className="glass-panel p-4 space-y-3">
              <div className="aspect-video bg-black rounded-lg overflow-hidden">
                {currentVideo.source_type === "youtube" && currentVideo.youtube_id ? (
                  <iframe
                    ref={ytPlayerRef}
                    src={`https://www.youtube.com/embed/${currentVideo.youtube_id}?enablejsapi=1`}
                    className="w-full h-full"
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                  />
                ) : uploadedUrl ? (
                  <video ref={videoRef} src={uploadedUrl} controls className="w-full h-full" />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    Loading…
                  </div>
                )}
              </div>
              <div className="flex items-center justify-center gap-2">
                <button onClick={() => seek(-5)} className="btn-crimson rounded-lg px-3 py-2 flex items-center gap-1">
                  <Rewind size={16} /> −5s
                </button>
                <button onClick={playPause} className="btn-crimson rounded-lg px-4 py-2 flex items-center gap-1">
                  <Play size={16} /> / <Pause size={16} />
                </button>
                <button onClick={() => seek(5)} className="btn-crimson rounded-lg px-3 py-2 flex items-center gap-1">
                  +5s <FastForward size={16} />
                </button>
              </div>
              <p className="text-sm text-muted-foreground text-center truncate">
                {currentVideo.title}
              </p>
            </div>
          )}

          {/* History strip */}
          <div>
            <p className="label-mono mb-2">Recent history</p>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {videos.data?.map((v) => (
                <div
                  key={v.id}
                  className="shrink-0 w-40 glass-panel-soft rounded-lg overflow-hidden hover:border-[color:var(--color-crimson-glow)] transition group relative"
                >
                  <button
                    onClick={() => loadFromHistory(v)}
                    className="w-full text-left"
                  >
                    <div className="aspect-video bg-black">
                      {v.thumbnail_url ? (
                        <img src={v.thumbnail_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                          {v.source_type === "upload" ? "📁 Upload" : "▶ YouTube"}
                        </div>
                      )}
                    </div>
                    <div className="p-2 text-xs truncate">{v.title || "Untitled"}</div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => deleteVideo(v, e)}
                    className="absolute top-1.5 right-1.5 p-1.5 rounded-md bg-black/80 backdrop-blur text-muted-foreground hover:text-red-400 hover:bg-red-500/20 opacity-70 md:opacity-0 md:group-hover:opacity-100 transition z-10"
                    aria-label="Delete video"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {videos.data?.length === 0 && (
                <p className="text-sm text-muted-foreground py-4">
                  Your history will appear here.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Notes column */}
        <NotesPanel videoId={currentVideo?.id ?? null} />
      </div>
    </div>
  );
}

function NotesPanel({ videoId }: { videoId: string | null }) {
  const qc = useQueryClient();
  const genFn = useServerFn(generateVocabCard);
  const [wordInput, setWordInput] = useState("");
  const [contextInput, setContextInput] = useState("");
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);

  const notes = useQuery({
    queryKey: ["shadowing_notes", videoId],
    queryFn: async () => {
      if (!videoId) return [] as NoteRow[];
      const { data, error } = await supabase
        .from("shadowing_notes")
        .select("*")
        .eq("video_id", videoId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as NoteRow[];
    },
    enabled: !!videoId,
  });

  const addNote = useMutation({
    mutationFn: async () => {
      if (!videoId) throw new Error("Load a video first");
      const user = (await supabase.auth.getUser()).data.user!;
      const { error } = await supabase.from("shadowing_notes").insert({
        video_id: videoId,
        word: wordInput.trim(),
        context: contextInput.trim(),
        user_id: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setWordInput("");
      setContextInput("");
      qc.invalidateQueries({ queryKey: ["shadowing_notes", videoId] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  async function generateForNote(note: NoteRow) {
    try {
      const card = (await genFn({ data: { word: note.word } })) as { id: string };
      await supabase.from("shadowing_notes").update({ card_id: card.id }).eq("id", note.id);
      qc.invalidateQueries({ queryKey: ["shadowing_notes", videoId] });
      qc.invalidateQueries({ queryKey: ["cards"] });
      toast.success(`Card generated for "${note.word}"`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function deleteNote(id: string) {
    await supabase.from("shadowing_notes").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["shadowing_notes", videoId] });
  }

  async function generateAll() {
    const pending = (notes.data ?? []).filter((n) => !n.card_id);
    if (pending.length === 0) return;
    setBatchProgress({ done: 0, total: pending.length });
    for (let i = 0; i < pending.length; i++) {
      try {
        await generateForNote(pending[i]);
      } catch {
        /* continue */
      }
      setBatchProgress({ done: i + 1, total: pending.length });
    }
    setBatchProgress(null);
  }

  const pendingCount = (notes.data ?? []).filter((n) => !n.card_id).length;

  return (
    <div className="glass-panel p-4 flex flex-col gap-3 max-h-[calc(100vh-160px)]">
      <p className="label-mono">My notes</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!wordInput.trim() || !videoId) return;
          addNote.mutate();
        }}
        className="space-y-2"
      >
        <input
          value={wordInput}
          onChange={(e) => setWordInput(e.target.value)}
          placeholder={videoId ? "Word or expression" : "Load a video first"}
          disabled={!videoId}
          className="w-full glass-panel-soft px-3 py-2 rounded-lg text-sm"
        />
        <input
          value={contextInput}
          onChange={(e) => setContextInput(e.target.value)}
          placeholder="Context (optional)"
          disabled={!videoId}
          className="w-full glass-panel-soft px-3 py-2 rounded-lg text-xs"
        />
        <button
          type="submit"
          disabled={!videoId || !wordInput.trim() || addNote.isPending}
          className="btn-crimson rounded-lg px-3 py-2 text-sm w-full flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Plus size={14} /> {addNote.isPending ? "Adding…" : "Create note"}
        </button>
      </form>

      <div className="flex-1 overflow-y-auto space-y-2 -mx-1 px-1">
        {(notes.data ?? []).map((n) => (
          <div
            key={n.id}
            className={`p-3 rounded-lg border transition ${
              n.card_id
                ? "border-emerald-500/40 bg-emerald-950/10 opacity-70"
                : "border-[color:var(--color-border)]"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{n.word}</p>
                {n.context && <p className="text-xs text-muted-foreground mt-0.5">{n.context}</p>}
              </div>
              <div className="flex gap-1 shrink-0">
                {n.card_id ? (
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <Check size={12} /> Card
                  </span>
                ) : (
                  <button
                    onClick={() => generateForNote(n)}
                    title="Generate a card"
                    className="p-1.5 hover:bg-white/10 rounded text-[color:var(--color-gold)]"
                  >
                    <Zap size={14} />
                  </button>
                )}
                <button
                  onClick={() => deleteNote(n.id)}
                  className="p-1.5 hover:bg-white/10 rounded text-muted-foreground"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {videoId && notes.data?.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-6">
            Add words as you watch.
          </p>
        )}
      </div>

      {pendingCount > 0 && (
        <button
          onClick={generateAll}
          disabled={batchProgress !== null}
          className="btn-crimson rounded-lg px-3 py-2.5 text-sm flex items-center justify-center gap-2"
        >
          <Zap size={14} />
          {batchProgress
            ? `${batchProgress.done}/${batchProgress.total}…`
            : `Generate all cards (${pendingCount})`}
        </button>
      )}
    </div>
  );
}

// Track current time for YouTube via postMessage listener
export function useYouTubeTimeTracker() {
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      try {
        const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (data?.info?.currentTime !== undefined) {
          (window as unknown as { __ytTime: number }).__ytTime = data.info.currentTime;
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);
}
