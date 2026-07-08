
ALTER TABLE public.fluency_sessions
  ADD COLUMN IF NOT EXISTS source_video_id uuid REFERENCES public.shadowing_videos(id) ON DELETE SET NULL;

ALTER TABLE public.shadowing_videos
  ADD COLUMN IF NOT EXISTS watch_duration_seconds integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retell_skipped_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_watched_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_fluency_sessions_source_video ON public.fluency_sessions(source_video_id);
CREATE INDEX IF NOT EXISTS idx_shadowing_videos_last_watched ON public.shadowing_videos(user_id, last_watched_at);
