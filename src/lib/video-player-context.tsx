import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouterState, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Play, Pause, X, Maximize2 } from "lucide-react";

export interface PersistentVideo {
  id: string;
  source_type: "youtube" | "upload";
  youtube_id: string | null;
  storage_path: string | null;
  title: string;
  thumbnail_url: string;
  created_at: string;
  watch_duration_seconds?: number;
  retell_skipped_count?: number;
}

interface Ctx {
  video: PersistentVideo | null;
  uploadedUrl: string | null;
  setVideo: (v: PersistentVideo | null, uploadedUrl?: string | null) => void;
  clearVideo: () => void;
  registerSlot: (el: HTMLElement | null) => void;
  seek: (delta: number) => void;
  playPause: () => void;
  sessionWatched: number;
  sessionStartAt: string | null;
}

const VideoPlayerContext = createContext<Ctx | null>(null);

export function useVideoPlayer() {
  const c = useContext(VideoPlayerContext);
  if (!c) throw new Error("useVideoPlayer must be used within VideoPlayerProvider");
  return c;
}

/**
 * Registers a DOM slot to display the persistent player over,
 * on any route that wants an inline video area. Player is mounted globally
 * in AppShell; this hook just tells it where to project itself.
 */
export function useVideoSlot() {
  const { registerSlot } = useVideoPlayer();
  // Callback ref: fires on mount AND unmount of the target DOM node.
  return useCallback(
    (el: HTMLDivElement | null) => {
      registerSlot(el);
    },
    [registerSlot],
  );
}

export function VideoPlayerProvider({ children }: { children: ReactNode }) {
  const [video, setVideoState] = useState<PersistentVideo | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  const [sessionStartAt, setSessionStartAt] = useState<string | null>(null);
  const [sessionWatched, setSessionWatched] = useState(0);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playingRef = useRef(false);
  const cumulRef = useRef(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const setVideo = useCallback((v: PersistentVideo | null, url: string | null = null) => {
    setVideoState(v);
    setUploadedUrl(url);
  }, []);

  const clearVideo = useCallback(() => {
    setVideoState(null);
    setUploadedUrl(null);
  }, []);

  const registerSlot = useCallback((el: HTMLElement | null) => {
    setSlotEl(el);
  }, []);

  // Reset session tracking when video changes
  useEffect(() => {
    if (!video) {
      setSessionStartAt(null);
      setSessionWatched(0);
      cumulRef.current = 0;
      playingRef.current = false;
      return;
    }
    setSessionStartAt(new Date().toISOString());
    setSessionWatched(0);
    cumulRef.current = Number(video.watch_duration_seconds) || 0;
    playingRef.current = false;
  }, [video?.id]);

  // YouTube: enable postMessage events
  useEffect(() => {
    if (!video || video.source_type !== "youtube") return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const send = () => {
      iframe.contentWindow?.postMessage(
        JSON.stringify({ event: "listening", id: "shadowing" }),
        "*",
      );
    };
    const t = setTimeout(send, 400);
    const onLoad = () => send();
    iframe.addEventListener("load", onLoad);
    const onMsg = (e: MessageEvent) => {
      try {
        const d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (d?.info?.playerState !== undefined) {
          playingRef.current = d.info.playerState === 1;
        }
        if (d?.info?.currentTime !== undefined) {
          (window as unknown as { __ytTime: number }).__ytTime = d.info.currentTime;
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("message", onMsg);
    return () => {
      clearTimeout(t);
      iframe.removeEventListener("load", onLoad);
      window.removeEventListener("message", onMsg);
    };
  }, [video?.id, video?.source_type]);

  // Upload video play/pause listener
  useEffect(() => {
    if (!video || video.source_type !== "upload") return;
    const el = videoRef.current;
    if (!el) return;
    const onPlay = () => (playingRef.current = true);
    const onPause = () => (playingRef.current = false);
    el.addEventListener("play", onPlay);
    el.addEventListener("playing", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("playing", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
    };
  }, [video?.id, uploadedUrl]);

  // Tick tracker
  useEffect(() => {
    if (!video) return;
    const vid = video;
    const interval = setInterval(async () => {
      if (!playingRef.current) return;
      cumulRef.current += 10;
      setSessionWatched((s) => s + 10);
      try {
        await supabase
          .from("shadowing_videos")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update({
            watch_duration_seconds: cumulRef.current,
            last_watched_at: new Date().toISOString(),
          } as any)
          .eq("id", vid.id);
      } catch {
        /* ignore */
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [video?.id]);

  const seek = useCallback(
    (delta: number) => {
      if (video?.source_type === "upload" && videoRef.current) {
        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + delta);
      } else if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({
            event: "command",
            func: "seekTo",
            args: [
              Math.max(0, (window as unknown as { __ytTime?: number }).__ytTime ?? 0) + delta,
              true,
            ],
          }),
          "*",
        );
      }
    },
    [video?.source_type],
  );

  const playPause = useCallback(() => {
    if (video?.source_type === "upload" && videoRef.current) {
      if (videoRef.current.paused) videoRef.current.play();
      else videoRef.current.pause();
    } else if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({
          event: "command",
          func: playingRef.current ? "pauseVideo" : "playVideo",
          args: [],
        }),
        "*",
      );
    }
  }, [video?.source_type]);

  // Reposition loop: mirror slotEl bounds, else mini bottom-right
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onShadowing = pathname === "/shadowing" || pathname.startsWith("/shadowing/");

  useEffect(() => {
    if (!video) return;
    let raf = 0;
    const el = containerRef.current;
    if (!el) return;

    const apply = () => {
      const c = containerRef.current;
      if (!c) return;
      if (slotEl) {
        const r = slotEl.getBoundingClientRect();
        c.style.top = `${r.top}px`;
        c.style.left = `${r.left}px`;
        c.style.width = `${r.width}px`;
        c.style.height = `${r.height}px`;
        c.style.borderRadius = "0.5rem";
        c.style.boxShadow = "none";
        c.dataset.mini = "false";
      } else {
        // mini bottom-right
        const w = 240;
        const h = 135;
        const margin = 16;
        c.style.top = `${window.innerHeight - h - margin}px`;
        c.style.left = `${window.innerWidth - w - margin}px`;
        c.style.width = `${w}px`;
        c.style.height = `${h + 40}px`; // extra for bar
        c.style.borderRadius = "0.75rem";
        c.style.boxShadow = "0 8px 32px rgba(0,0,0,0.5)";
        c.dataset.mini = "true";
      }
      raf = requestAnimationFrame(apply);
    };
    raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
  }, [video, slotEl]);

  const ctx = useMemo<Ctx>(
    () => ({
      video,
      uploadedUrl,
      setVideo,
      clearVideo,
      registerSlot,
      seek,
      playPause,
      sessionWatched,
      sessionStartAt,
    }),
    [video, uploadedUrl, setVideo, clearVideo, registerSlot, seek, playPause, sessionWatched, sessionStartAt],
  );

  const navigate = useNavigate();

  return (
    <VideoPlayerContext.Provider value={ctx}>
      {children}
      {video && (
        <div
          ref={containerRef}
          className="fixed z-40 overflow-hidden transition-none"
          style={{ pointerEvents: video ? "auto" : "none" }}
        >
          <div className="relative w-full bg-black" style={{ height: slotEl ? "100%" : "135px" }}>
            {video.source_type === "youtube" && video.youtube_id ? (
              <iframe
                ref={iframeRef}
                src={`https://www.youtube.com/embed/${video.youtube_id}?enablejsapi=1`}
                className="w-full h-full block"
                allow="autoplay; encrypted-media"
                allowFullScreen
                title={video.title}
              />
            ) : uploadedUrl ? (
              <video
                ref={videoRef}
                src={uploadedUrl}
                controls
                className="w-full h-full block object-contain bg-black"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Chargement…
              </div>
            )}
          </div>
          {!slotEl && (
            <div className="glass-panel-soft border-t border-[color:var(--color-crimson-glow)]/50 backdrop-blur-lg bg-black/70 flex items-center gap-1 px-2 h-10">
              <button
                onClick={playPause}
                className="p-1.5 rounded hover:bg-white/10 text-[color:var(--color-gold)]"
                aria-label="Play/Pause"
              >
                <Play size={14} />
              </button>
              <button
                onClick={playPause}
                className="p-1.5 rounded hover:bg-white/10 text-muted-foreground"
                aria-label="Pause"
              >
                <Pause size={14} />
              </button>
              <div className="flex-1 min-w-0 text-[11px] truncate px-1">{video.title}</div>
              <button
                onClick={() => navigate({ to: "/shadowing" })}
                className="p-1.5 rounded hover:bg-white/10 text-[color:var(--color-gold)]"
                aria-label="Retour au shadowing"
                title="Retour au shadowing"
              >
                <Maximize2 size={13} />
              </button>
              <button
                onClick={clearVideo}
                className="p-1.5 rounded hover:bg-white/10 text-muted-foreground"
                aria-label="Fermer"
              >
                <X size={13} />
              </button>
            </div>
          )}
        </div>
      )}
    </VideoPlayerContext.Provider>
  );
}
