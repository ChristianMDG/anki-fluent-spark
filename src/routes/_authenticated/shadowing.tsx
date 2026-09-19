import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { generateVocabCard } from "@/lib/vocab.functions";
import { toast } from "sonner";
import {
  Youtube,
  Upload,
  Rewind,
  FastForward,
  Play,
  Pause,
  Zap,
  X,
  Check,
  Plus,
  Trash2,
  CheckCircle2,
  Info,
  Pencil,
  Radio,
  Tv,
  NotebookTabs,
  Layers,
  Video,
  History,
} from "lucide-react";
import { confirmDialog } from "@/components/ConfirmDialog";
import { RetellItModal } from "@/components/RetellItModal";
import { SourceLibrary } from "@/components/SourceLibrary";
import { VocabPreviewModal } from "@/components/VocabPreviewModal";
import { FullLessonModal } from "@/components/FullLessonModal";
import type { CardRow } from "@/components/VocabCard";
import {
  useVideoPlayer,
  useVideoSlot,
  supportsTransportControls,
  type PersistentVideo,
  type VideoSourceType,
} from "@/lib/video-player-context";

function isFacebookVideoUrl(url: string): boolean {
  return /^(https?:\/\/)?([\w-]+\.)*(facebook\.com|fb\.watch)\/\S+$/i.test(url.trim());
}

export const Route = createFileRoute("/_authenticated/shadowing")({
  component: ShadowingPage,
});

const SKIP_BANNER_KEY = "retell-skip-banner-dismissed-at";
type VideoRow = PersistentVideo;

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
  const player = useVideoPlayer();
  const slotRef = useVideoSlot();

  const [mode, setMode] = useState<VideoSourceType>("youtube");
  const [ytUrl, setYtUrl] = useState("");
  const [fbUrl, setFbUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyDrawerRef = useRef<HTMLDivElement | null>(null);
  const historyToggleRef = useRef<HTMLButtonElement | null>(null);

  const currentVideo = player.video;
  const sessionWatched = player.sessionWatched;
  const sessionStartAt = player.sessionStartAt;

  const [retellOpen, setRetellOpen] = useState(false);
  const [retellVideo, setRetellVideo] = useState<VideoRow | null>(null);
  const [retellNotes, setRetellNotes] = useState<{ id: string; word: string }[]>([]);
  const [retellWatched, setRetellWatched] = useState(0);
  const [bannerDismissed, setBannerDismissed] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(SKIP_BANNER_KEY);
    if (!raw) return setBannerDismissed(false);
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return setBannerDismissed(false);
    setBannerDismissed(Date.now() - ts < 3 * 24 * 60 * 60 * 1000);
  }, []);

  const skipSum = useQuery({
    queryKey: ["retell-skip-sum-7d"],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 7);
      const { data } = await supabase
        .from("shadowing_videos")
        .select("retell_skipped_count,last_watched_at")
        .gte("last_watched_at", since.toISOString());
      return (data ?? []).reduce((s, r) => s + (Number(r.retell_skipped_count) || 0), 0);
    },
    staleTime: 60_000,
  });

  const videos = useQuery({
    queryKey: ["shadowing_videos", "list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shadowing_videos")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return data as VideoRow[];
    },
  });

  useEffect(() => {
    if (!historyOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (historyDrawerRef.current?.contains(target)) return;
      if (historyToggleRef.current?.contains(target)) return;
      setHistoryOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHistoryOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [historyOpen]);

  const openRetellFor = useCallback(
    async (v: VideoRow, watched: number, startedAt: string | null) => {
      let notesList: { id: string; word: string }[] = [];
      if (startedAt) {
        const { data } = await supabase
          .from("shadowing_notes")
          .select("id,word")
          .eq("video_id", v.id)
          .gte("created_at", startedAt);
        notesList = (data ?? []) as { id: string; word: string }[];
      }
      setRetellVideo(v);
      setRetellWatched(watched);
      setRetellNotes(notesList);
      setRetellOpen(true);
    },
    [],
  );

  const maybeOfferRetell = useCallback(async () => {
    if (!currentVideo) return;
    if (sessionWatched < 90) return;
    await openRetellFor(currentVideo, sessionWatched, sessionStartAt);
  }, [currentVideo, sessionWatched, sessionStartAt, openRetellFor]);

  async function handleSkipRetell() {
    if (!retellVideo) return;
    try {
      const { data } = await supabase
        .from("shadowing_videos")
        .select("retell_skipped_count")
        .eq("id", retellVideo.id)
        .single();
      const cur = Number(data?.retell_skipped_count) || 0;
      await supabase
        .from("shadowing_videos")
        .update({ retell_skipped_count: cur + 1 })
        .eq("id", retellVideo.id);
      qc.invalidateQueries({ queryKey: ["retell-skip-sum-7d"] });
    } catch {
      /* ignore */
    }
  }

  function dismissBanner() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SKIP_BANNER_KEY, String(Date.now()));
    }
    setBannerDismissed(true);
  }

  const showSkipBanner = !bannerDismissed && (skipSum.data ?? 0) > 3;

  async function loadYoutube(urlOverride?: string) {
    const raw = (urlOverride ?? ytUrl).trim();
    const id = extractYouTubeId(raw);
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
    player.setVideo(data as VideoRow, null);
    setYtUrl("");
    setFbUrl("");
    qc.invalidateQueries({ queryKey: ["shadowing_videos"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  }

  async function loadFacebook(urlOverride?: string) {
    const url = (urlOverride ?? fbUrl).trim();
    if (!isFacebookVideoUrl(url)) return toast.error("Invalid Facebook video URL");
    const { data, error } = await supabase
      .from("shadowing_videos")
      .insert({
        source_type: "facebook",
        source_url: url,
        title: `Facebook video — ${url.length > 48 ? `${url.slice(0, 48)}…` : url}`,
        thumbnail_url: "",
        user_id: (await supabase.auth.getUser()).data.user!.id,
      })
      .select()
      .single();
    if (error) return toast.error(error.message);
    player.setVideo(data as VideoRow, null);
    setFbUrl("");
    setYtUrl("");
    qc.invalidateQueries({ queryKey: ["shadowing_videos"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  }

  async function loadAnyStream(inputUrl?: string) {
    const raw = (inputUrl ?? ytUrl).trim();
    if (!raw) return;
    if (isFacebookVideoUrl(raw)) {
      await loadFacebook(raw);
    } else if (extractYouTubeId(raw)) {
      await loadYoutube(raw);
    } else {
      toast.error("Invalid video URL (YouTube or Facebook link required)");
    }
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
      const signed = await supabase.storage
        .from("shadowing-videos")
        .createSignedUrl(path, 3600 * 4);
      player.setVideo(data as VideoRow, signed.data?.signedUrl ?? null);
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
    if (v.source_type === "upload" && v.storage_path) {
      const signed = await supabase.storage
        .from("shadowing-videos")
        .createSignedUrl(v.storage_path, 3600 * 4);
      player.setVideo(v, signed.data?.signedUrl ?? null);
    } else {
      player.setVideo(v, null);
    }
    setHistoryOpen(false);
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
      player.clearVideo();
    }
    qc.invalidateQueries({ queryKey: ["shadowing_videos"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
    toast.success("Video deleted");
  }

  return (
    <div className="max-w-[1840px] mx-auto px-1 sm:px-2 min-h-0 lg:h-[calc(100vh-7rem)] lg:min-h-[650px] flex flex-col gap-3 font-mono text-white overflow-visible lg:overflow-hidden">
      {/* Banner info */}
      {showSkipBanner && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-2 text-xs flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Info size={14} className="text-amber-400" />
            <p className="text-neutral-300">
              You skipped several Retell its recently — even 30 seconds helps a lot with fluency.
            </p>
          </div>
          <button onClick={dismissBanner} className="text-neutral-500 hover:text-white p-1">
            <X size={12} />
          </button>
        </div>
      )}

      <SourceLibrary />

      {/* Main Responsive Grid Workspace */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1450px)_360px] justify-center gap-3 min-h-0 min-w-0 relative">
        {/* LEFT COMPONENT: Immersive Player Suite */}
        <div className="flex flex-col min-h-[560px] lg:min-h-0 min-w-0">
          {/* Main Stage (Video Player / Injection Node) */}
          <div className="flex-1 bg-gradient-to-br from-[#120403]/60 via-[#0d0605]/40 to-black/60 backdrop-blur-md border border-[var(--color-border)]/40 p-4 rounded-2xl flex flex-col justify-between min-h-0 relative shadow-2xl">
            {currentVideo ? (
              <div className="flex flex-col h-full justify-between gap-3 min-h-0">
                {/* Telemetry Header */}
                <div className="flex items-center justify-between text-[10px] tracking-wider uppercase">
                  <div className="flex items-center gap-2 text-[var(--color-crimson)]">
                    <Radio size={12} className="animate-pulse" />
                    <span className="font-audiowide text-[var(--color-gold)]">
                      Cinema Workspace
                    </span>
                  </div>
                  <span className="text-neutral-500 truncate max-w-[300px]">
                    {currentVideo.title}
                  </span>
                </div>

                {/* Highly Scaled Video Screen Container */}
                <div className="flex-1 bg-black rounded-xl overflow-hidden border border-white/5 relative flex items-center justify-center min-h-0 group shadow-inner">
                  <div ref={slotRef} className="w-full h-full aspect-video" />
                </div>

                {/* Command Deck Controls & Telemetry */}
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-white/5 pt-3 sm:flex sm:flex-row sm:justify-between">
                  {supportsTransportControls(currentVideo) ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => player.seek(-5)}
                        className="bg-neutral-900 border border-white/5 hover:border-[var(--color-crimson)] px-3 py-1.5 text-xs rounded-lg transition flex items-center gap-1"
                      >
                        <Rewind size={12} /> -5s
                      </button>
                      <button
                        onClick={player.playPause}
                        className="bg-[var(--color-crimson)] px-4 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-1 shadow-[0_0_10px_rgba(220,38,38,0.2)] hover:opacity-90"
                      >
                        <Play size={11} className="fill-current" /> / <Pause size={11} />
                      </button>
                      <button
                        onClick={() => player.seek(5)}
                        className="bg-neutral-900 border border-white/5 hover:border-[var(--color-crimson)] px-3 py-1.5 text-xs rounded-lg transition flex items-center gap-1"
                      >
                        +5s <FastForward size={12} />
                      </button>
                    </div>
                  ) : (
                    <p className="text-[10px] uppercase tracking-wider text-neutral-500">
                      Use the Facebook player's own controls
                    </p>
                  )}

                  <div className="flex min-w-0 items-center gap-2 sm:gap-4 w-full sm:w-auto justify-end">
                    <button
                      ref={historyToggleRef}
                      type="button"
                      onClick={() => setHistoryOpen((open) => !open)}
                      aria-expanded={historyOpen}
                      aria-controls="shadowing-history-drawer"
                      className={`shrink-0 border px-2.5 py-1.5 text-xs rounded-lg flex items-center gap-1.5 transition-colors ${historyOpen ? "bg-[var(--color-crimson)]/20 border-[var(--color-crimson)]/50 text-white" : "bg-neutral-950/60 border-white/5 text-neutral-400 hover:text-white hover:border-white/15"}`}
                    >
                      <History size={13} /> History ({videos.data?.length ?? 0})
                    </button>
                    <span className="text-[11px] text-[var(--color-gold)] font-audiowide bg-neutral-950/80 px-2.5 py-1.5 border border-white/5 rounded-md">
                      SESSION: {Math.floor(sessionWatched / 60)}:
                      {(sessionWatched % 60).toString().padStart(2, "0")}
                    </span>
                    <button
                      onClick={maybeOfferRetell}
                      disabled={sessionWatched < 90}
                      className="bg-neutral-950/60 border border-emerald-500/30 text-emerald-400 disabled:opacity-30 disabled:border-white/5 disabled:text-neutral-500 px-3 py-1.5 text-xs rounded-lg flex items-center gap-1.5 transition font-bold"
                    >
                      <CheckCircle2 size={13} /> Complete
                    </button>
                  </div>
                </div>

                {/* Swap-stream bar — load a different video while one is active */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    loadAnyStream();
                  }}
                  className="flex gap-2 border-t border-white/5 pt-3"
                >
                  <Video size={13} className="shrink-0 self-center text-[var(--color-crimson)] opacity-70" />
                  <input
                    value={ytUrl}
                    onChange={(e) => setYtUrl(e.target.value)}
                    placeholder="Swap stream — paste YouTube or Facebook URL…"
                    className="flex-1 min-w-0 bg-neutral-950 border border-white/5 px-3 py-1.5 text-xs text-white placeholder-neutral-600 rounded-lg focus:outline-none focus:border-[var(--color-crimson)]"
                  />
                  <button
                    type="submit"
                    disabled={!ytUrl.trim()}
                    className="bg-neutral-900 border border-white/5 hover:border-[var(--color-crimson)] disabled:opacity-40 px-3 py-1.5 text-xs rounded-lg transition shrink-0 flex items-center gap-1"
                  >
                    <Play size={11} className="fill-current text-[var(--color-crimson)]" /> Load
                  </button>
                </form>
              </div>
            ) : (
              /* Core Empty Injector Hub */
              <div className="h-full flex flex-col justify-between p-4">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-white/5 pb-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Tv size={14} className="shrink-0 text-[var(--color-crimson)] animate-pulse" />
                    <span className="truncate font-audiowide text-xs text-[var(--color-gold)] uppercase tracking-wider">
                      Feed Injector Core
                    </span>
                  </div>
                  <button
                    ref={historyToggleRef}
                    type="button"
                    onClick={() => setHistoryOpen((open) => !open)}
                    aria-expanded={historyOpen}
                    aria-controls="shadowing-history-drawer"
                    className={`shrink-0 border px-2.5 py-1.5 text-xs rounded-lg flex items-center gap-1.5 transition-colors ${historyOpen ? "bg-[var(--color-crimson)]/20 border-[var(--color-crimson)]/50 text-white" : "bg-neutral-950/60 border-white/5 text-neutral-400 hover:text-white hover:border-white/15"}`}
                  >
                    <History size={13} /> History ({videos.data?.length ?? 0})
                  </button>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-neutral-600 max-w-sm mx-auto">
                  <Tv
                    size={28}
                    className="stroke-[1.2] mb-2 opacity-40 text-[var(--color-crimson)]"
                  />
                  <p className="text-xs uppercase font-bold tracking-wider">Workspace Idle</p>
                  <p className="text-[10px] opacity-70 mt-1">
                    Provide a cryptographic URL stream or drop a spatial media asset file below to
                    initialize shadowing mode.
                  </p>
                </div>

                <div className="bg-neutral-950/60 border border-white/5 p-4 rounded-xl">
                  <div className="flex gap-2 mb-3 bg-black/40 p-0.5 rounded-md w-fit border border-white/5">
                    <button
                      onClick={() => setMode("youtube")}
                      className={`px-3 py-1 text-[10px] uppercase font-bold tracking-wider rounded transition ${mode === "youtube" ? "bg-[var(--color-crimson)]/20 border border-[var(--color-crimson)]/40 text-white" : "text-neutral-500"}`}
                    >
                      YouTube
                    </button>
                    <button
                      onClick={() => setMode("facebook")}
                      className={`px-3 py-1 text-[10px] uppercase font-bold tracking-wider rounded transition ${mode === "facebook" ? "bg-[var(--color-crimson)]/20 border border-[var(--color-crimson)]/40 text-white" : "text-neutral-500"}`}
                    >
                      Facebook
                    </button>
                    <button
                      onClick={() => setMode("upload")}
                      className={`px-3 py-1 text-[10px] uppercase font-bold tracking-wider rounded transition ${mode === "upload" ? "bg-[var(--color-crimson)]/20 border border-[var(--color-crimson)]/40 text-white" : "text-neutral-500"}`}
                    >
                      Upload
                    </button>
                  </div>

                  {mode === "facebook" ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        loadFacebook();
                      }}
                      className="flex gap-2"
                    >
                      <input
                        value={fbUrl}
                        onChange={(e) => setFbUrl(e.target.value)}
                        placeholder="Target URL: https://facebook.com/... or https://fb.watch/..."
                        className="flex-1 bg-neutral-950 border border-white/5 px-3 py-2 text-xs text-white placeholder-neutral-600 rounded-lg focus:outline-none focus:border-[var(--color-crimson)]"
                      />
                      <button className="bg-[var(--color-crimson)] px-4 py-2 text-xs font-bold rounded-lg hover:opacity-95 transition shrink-0">
                        Load Stream
                      </button>
                    </form>
                  ) : mode === "youtube" ? (
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
                        placeholder="Target URL: https://youtube.com/watch?v=..."
                        className="flex-1 bg-neutral-950 border border-white/5 px-3 py-2 text-xs text-white placeholder-neutral-600 rounded-lg focus:outline-none focus:border-[var(--color-crimson)]"
                      />
                      <button className="bg-[var(--color-crimson)] px-4 py-2 text-xs font-bold rounded-lg hover:opacity-95 transition shrink-0">
                        Load Stream
                      </button>
                    </form>
                  ) : (
                    <label className="block border border-dashed border-white/10 rounded-lg p-5 text-center cursor-pointer hover:border-[var(--color-crimson)] bg-neutral-950/40 transition">
                      <input
                        type="file"
                        accept="video/mp4,video/webm,video/quicktime,.mov"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleUpload(f);
                        }}
                      />
                      <Upload className="mx-auto mb-1 text-[var(--color-gold)]" size={20} />
                      <p className="text-xs">
                        {uploading ? "Mounting asset..." : "Drop file asset or browse"}
                      </p>
                      <p className="text-[10px] text-neutral-600 mt-0.5">
                        MP4, WEBM, MOV (Max 200MB)
                      </p>
                    </label>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COMPONENT: history temporarily overlays the notes, never the player */}
        <div className="relative min-h-[420px] lg:min-h-0 min-w-0 overflow-hidden rounded-2xl">
          <NotesPanel videoId={currentVideo?.id ?? null} />
          <div
            ref={historyDrawerRef}
            id="shadowing-history-drawer"
            aria-hidden={!historyOpen}
            className={`absolute inset-0 z-20 bg-neutral-950/95 backdrop-blur-xl border border-[var(--color-border)]/50 rounded-2xl shadow-2xl flex flex-col min-h-0 transition-[transform,opacity,visibility] duration-300 ease-out motion-reduce:transition-none ${historyOpen ? "translate-x-0 opacity-100 visible pointer-events-auto" : "translate-x-[calc(100%+1rem)] opacity-0 invisible pointer-events-none"}`}
          >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 border-b border-white/5 shrink-0">
              <div className="min-w-0">
                <p className="font-audiowide text-[10px] uppercase text-[var(--color-gold)] flex items-center gap-1.5">
                  <History size={12} className="shrink-0" /> Recent history
                </p>
                <p className="text-[9px] text-neutral-500 mt-0.5">
                  {videos.data?.length ?? 0} saved {(videos.data?.length ?? 0) === 1 ? "video" : "videos"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                aria-label="Close history"
                className="p-1.5 rounded-md border border-white/5 text-neutral-400 hover:text-white hover:border-white/15 transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-2">
              {videos.data?.map((v) => {
                const isActive = currentVideo?.id === v.id;
                return (
                  <div
                    key={v.id}
                    className={`grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-2.5 bg-black/30 border rounded-lg overflow-hidden group transition-colors ${isActive ? "border-[var(--color-gold)]/70 bg-[var(--color-gold)]/5" : "border-white/5 hover:border-white/15"}`}
                  >
                    <button
                      type="button"
                      onClick={() => void loadFromHistory(v)}
                      className="contents text-left"
                      aria-label={`Load ${v.title || "Untitled video"}`}
                    >
                      <div className="aspect-video bg-neutral-900 relative overflow-hidden">
                        {v.thumbnail_url ? (
                          <img
                            src={v.thumbnail_url}
                            alt=""
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-1 h-full text-[8px] text-neutral-500 uppercase bg-gradient-to-br from-neutral-900 to-black">
                            <Video size={13} className="opacity-60 text-[var(--color-crimson)]" />
                            {v.source_type === "upload"
                              ? "Local File"
                              : v.source_type === "facebook"
                                ? "Facebook"
                                : "Stream"}
                          </div>
                        )}
                        {isActive && (
                          <span className="absolute top-1 left-1 font-audiowide text-[7px] px-1 py-0.5 rounded bg-[var(--color-gold)]/20 text-[var(--color-gold)] border border-[var(--color-gold)]/30">
                            LIVE
                          </span>
                        )}
                      </div>
                      <span className="min-w-0 text-[10px] font-mono truncate text-neutral-300 group-hover:text-white">
                        {v.title || "Untitled Node"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => void deleteVideo(v, e)}
                      className="mr-2 p-1.5 rounded-md text-neutral-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      aria-label={`Delete ${v.title || "video"}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })}
              {videos.data?.length === 0 && (
                <div className="border border-dashed border-white/5 p-8 rounded-xl text-center text-neutral-600">
                  <Layers size={18} className="mx-auto mb-2 opacity-60" />
                  <p className="text-[10px] uppercase tracking-wider">No saved videos yet</p>
                </div>
              )}
            </div>

            <div className="p-3 border-t border-white/5 shrink-0">
              <Link
                to="/history"
                onClick={() => setHistoryOpen(false)}
                className="flex items-center justify-center w-full px-3 py-2 rounded-lg border border-white/5 bg-black/30 text-[10px] uppercase text-neutral-400 hover:text-white hover:border-white/15 transition-colors"
              >
                Open full history →
              </Link>
            </div>
          </div>
        </div>
      </div>

      <RetellItModal
        open={retellOpen}
        video={retellVideo}
        watchedSeconds={retellWatched}
        notes={retellNotes}
        onClose={() => setRetellOpen(false)}
        onSkip={handleSkipRetell}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["fluency-streak"] });
          qc.invalidateQueries({ queryKey: ["fluency-journal"] });
          qc.invalidateQueries({ queryKey: ["listen-vs-produce"] });
        }}
      />
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

  const [previewState, setPreviewState] = useState<{
    word: string;
    cardId: string | null;
    isGenerating: boolean;
  } | null>(null);
  const [fullLessonDetails, setFullLessonDetails] = useState<{
    cardId: string;
    word: string;
    ipa: string;
    level: string;
  } | null>(null);

  const activeCardQuery = useQuery({
    queryKey: ["card_preview", previewState?.cardId],
    queryFn: async (): Promise<CardRow | null> => {
      if (!previewState?.cardId) return null;
      const { data, error } = await supabase
        .from("cards")
        .select("*")
        .eq("id", previewState.cardId)
        .maybeSingle();
      if (error) throw error;
      return (data as CardRow) ?? null;
    },
    enabled: !!previewState?.cardId,
  });

  async function generateForNote(note: NoteRow) {
    try {
      const card = (await genFn({ data: { word: note.word } })) as { id: string };
      await supabase.from("shadowing_notes").update({ card_id: card.id }).eq("id", note.id);
      qc.invalidateQueries({ queryKey: ["shadowing_notes", videoId] });
      qc.invalidateQueries({ queryKey: ["cards"] });
      toast.success(`Card generated for "${note.word}"`);
      return card;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    }
  }

  async function handleSelectNote(note: NoteRow) {
    if (note.card_id) {
      setPreviewState({
        word: note.word,
        cardId: note.card_id,
        isGenerating: false,
      });
    } else {
      setPreviewState({
        word: note.word,
        cardId: null,
        isGenerating: true,
      });
      const card = await generateForNote(note);
      if (card?.id) {
        setPreviewState({
          word: note.word,
          cardId: card.id,
          isGenerating: false,
        });
      } else {
        setPreviewState(null);
      }
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
    <div className="bg-gradient-to-br from-[#120403]/40 via-[#0d0605]/30 to-black/40 border border-[var(--color-border)]/40 p-4 rounded-2xl flex flex-col gap-3 h-full min-h-0 overflow-hidden shadow-2xl relative">
      <div className="pointer-events-none absolute -top-10 -right-10 w-32 h-32 bg-[color:var(--color-gold)]/5 rounded-full blur-2xl" />

      <div className="flex items-center justify-between border-b border-white/5 pb-2 shrink-0">
        <div className="flex items-center gap-1.5 text-neutral-400 font-bold uppercase text-[10px]">
          <NotebookTabs size={13} className="text-[var(--color-gold)]" />
          <span>Biometric Logs</span>
        </div>
        {(notes.data?.length ?? 0) > 0 && (
          <span className="text-[9px] bg-neutral-950 px-2 py-0.5 rounded border border-white/5 text-neutral-400">
            {(notes.data?.length ?? 0) - pendingCount}/{(notes.data?.length ?? 0)} Done
          </span>
        )}
      </div>

      {/* Input Injection Module */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!wordInput.trim() || !videoId) return;
          addNote.mutate();
        }}
        className="space-y-2 shrink-0"
      >
        <input
          value={wordInput}
          onChange={(e) => setWordInput(e.target.value)}
          placeholder={videoId ? "Expression token..." : "Load stream to record..."}
          disabled={!videoId}
          className="w-full bg-neutral-950 border border-white/5 px-3 py-2 rounded-lg text-xs focus:outline-none focus:border-[var(--color-crimson)] text-white placeholder-neutral-600"
        />
        <input
          value={contextInput}
          onChange={(e) => setContextInput(e.target.value)}
          placeholder="Context matrix (optional)..."
          disabled={!videoId}
          className="w-full bg-neutral-950 border border-white/5 px-3 py-2 rounded-lg text-[11px] focus:outline-none focus:border-[var(--color-crimson)] text-white placeholder-neutral-600"
        />
        <button
          type="submit"
          disabled={!videoId || !wordInput.trim() || addNote.isPending}
          className="bg-[var(--color-crimson)] disabled:bg-neutral-900 disabled:text-neutral-600 text-white rounded-lg px-3 py-2 text-xs font-bold w-full flex items-center justify-center gap-1.5 transition"
        >
          <Plus size={13} /> {addNote.isPending ? "Adding Token..." : "Register Note"}
        </button>
      </form>

      {/* Vertical Autonomously Scrollable Stack */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar min-h-0">
        {(notes.data ?? []).map((n) => (
          <NoteItem
            key={n.id}
            note={n}
            videoId={videoId}
            onSelectWord={() => handleSelectNote(n)}
            onGenerate={() => handleSelectNote(n)}
            onDelete={() => deleteNote(n.id)}
          />
        ))}
        {videoId && notes.data?.length === 0 && (
          <div className="border border-dashed border-white/5 p-6 rounded-xl text-center text-neutral-600 my-4 bg-neutral-950/20">
            <p className="text-[10px] uppercase font-bold tracking-wider">Log Array Void</p>
            <p className="text-[9px] opacity-70 mt-0.5">
              Capture unfamiliar lexical markers dynamically during training.
            </p>
          </div>
        )}
      </div>

      {/* Bulk Compiler Control */}
      {pendingCount > 0 && (
        <div className="space-y-2 pt-2 border-t border-white/5 shrink-0">
          {batchProgress && (
            <div className="h-1 bg-black rounded-full overflow-hidden border border-white/5">
              <div
                className="h-full bg-gradient-to-r from-[var(--color-crimson)] to-[var(--color-gold)] transition-all duration-300"
                style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%` }}
              />
            </div>
          )}
          <button
            onClick={generateAll}
            disabled={batchProgress !== null}
            className="bg-[var(--color-crimson)]/20 border border-[var(--color-crimson)]/40 hover:bg-[var(--color-crimson)]/30 text-[var(--color-gold)] font-bold text-xs rounded-lg px-3 py-2.5 flex items-center justify-center gap-2 w-full transition shadow-[0_0_15px_rgba(220,38,38,0.05)]"
          >
            <Zap size={13} />
            {batchProgress
              ? `Processing [${batchProgress.done}/${batchProgress.total}]`
              : `Compile All Queued [${pendingCount}]`}
          </button>
        </div>
      )}

      {previewState && (
        <VocabPreviewModal
          word={previewState.word}
          card={activeCardQuery.data ?? null}
          loading={previewState.isGenerating || (activeCardQuery.isLoading && !activeCardQuery.data)}
          onOpenFullLesson={() => {
            if (activeCardQuery.data) {
              setFullLessonDetails({
                cardId: activeCardQuery.data.id,
                word: activeCardQuery.data.word,
                ipa: activeCardQuery.data.ipa ?? "",
                level: activeCardQuery.data.level ?? "",
              });
            }
            setPreviewState(null);
          }}
          onClose={() => setPreviewState(null)}
        />
      )}

      {fullLessonDetails && (
        <FullLessonModal
          cardId={fullLessonDetails.cardId}
          word={fullLessonDetails.word}
          ipa={fullLessonDetails.ipa}
          level={fullLessonDetails.level}
          onClose={() => setFullLessonDetails(null)}
        />
      )}
    </div>
  );
}

function NoteItem({
  note,
  videoId,
  onSelectWord,
  onGenerate,
  onDelete,
}: {
  note: NoteRow;
  videoId: string | null;
  onSelectWord: () => void;
  onGenerate: () => void;
  onDelete: () => void;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [wordDraft, setWordDraft] = useState(note.word);
  const [contextDraft, setContextDraft] = useState(note.context ?? "");
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setWordDraft(note.word);
    setContextDraft(note.context ?? "");
    setEditing(true);
  }

  async function saveEdit() {
    const w = wordDraft.trim();
    if (!w) return toast.error("The word cannot be empty");
    setSaving(true);
    const { error } = await supabase
      .from("shadowing_notes")
      .update({ word: w, context: contextDraft.trim() || null })
      .eq("id", note.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    if (note.card_id && w !== note.word) {
      toast.warning("Note updated, but its flashcard still uses the old word", {
        description: `The card generated from "${note.word}" was not regenerated.`,
      });
    }
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["shadowing_notes", videoId] });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void saveEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
    }
  }


  async function handleConfirmDelete() {
    const ok = await confirmDialog({
      title: "Delete this note?",
      description: `"${note.word}" will be permanently removed from this video's logs.`,
      confirmLabel: "Delete note",
    });
    if (ok) {
      onDelete();
    }
  }

  return (
    <div
      className={`p-2.5 rounded-xl border border-white/5 bg-neutral-950/40 border-l-2 transition ${note.card_id ? "border-l-emerald-500/80 bg-emerald-950/5" : "border-l-[var(--color-gold)]/60"} ${note.card_id && !editing ? "opacity-90" : ""}`}
    >
      {editing ? (
        <div className="space-y-2">
          <input
            autoFocus
            value={wordDraft}
            onChange={(e) => setWordDraft(e.target.value)}
            className="w-full bg-neutral-950 border border-white/5 px-2 py-1 rounded text-xs text-white focus:outline-none"
          />
          <input
            value={contextDraft}
            onChange={(e) => setContextDraft(e.target.value)}
            className="w-full bg-neutral-950 border border-white/5 px-2 py-1 rounded text-[11px] text-neutral-400 focus:outline-none"
          />
          <div className="flex justify-end gap-1 text-[10px]">
            <button
              onClick={saveEdit}
              disabled={saving}
              className="text-emerald-400 px-2 py-0.5 bg-neutral-900 border border-white/5 rounded"
            >
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-neutral-400 px-2 py-0.5 bg-neutral-900 border border-white/5 rounded"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3 w-full min-w-0">
          <button
            type="button"
            onClick={onSelectWord}
            className="min-w-0 flex-1 space-y-0.5 text-left group/word"
            title="Click to preview flashcard"
          >
            <p className="text-xs font-bold truncate text-white group-hover/word:text-[color:var(--color-gold)] transition underline decoration-dotted decoration-white/30 underline-offset-2">
              {note.word}
            </p>
            {note.context && (
              <p className="text-[10px] text-neutral-500 line-clamp-2 leading-relaxed break-words">
                {note.context}
              </p>
            )}
          </button>
          <div className="flex gap-1.5 items-center shrink-0 self-start bg-neutral-950/60 p-0.5 rounded-md border border-white/5">
            {note.card_id ? (
              <button
                type="button"
                onClick={onSelectWord}
                title="View Flashcard"
                className="p-1 hover:bg-white/5 text-emerald-400 rounded shrink-0 flex items-center"
              >
                <Check size={12} />
              </button>
            ) : (
              <button
                onClick={onGenerate}
                title="Compile Flashcard"
                className="p-1 hover:bg-white/5 text-[var(--color-gold)] rounded shrink-0"
              >
                <Zap size={12} />
              </button>
            )}
            <button
              onClick={startEdit}
              title="Modify Node"
              className="p-1 hover:bg-white/5 text-neutral-400 hover:text-white rounded shrink-0"
            >
              <Pencil size={11} />
            </button>
            <button
              onClick={handleConfirmDelete}
              title="Purge Node"
              className="p-1 hover:bg-red-500/20 text-red-400 hover:text-red-300 rounded shrink-0 transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

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
