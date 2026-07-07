
CREATE TABLE public.fluency_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  session_length TEXT NOT NULL,
  week_theme TEXT NOT NULL DEFAULT '',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fluency_sessions TO authenticated;
GRANT ALL ON public.fluency_sessions TO service_role;
ALTER TABLE public.fluency_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY fluency_sessions_owner_all ON public.fluency_sessions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.fluency_recordings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  session_id UUID REFERENCES public.fluency_sessions(id) ON DELETE CASCADE,
  exercise_type TEXT NOT NULL,
  prompt_text TEXT NOT NULL DEFAULT '',
  week_theme TEXT NOT NULL DEFAULT '',
  storage_path TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  fluency_rating INTEGER,
  confidence_rating INTEGER,
  hesitation_rating INTEGER,
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fluency_recordings TO authenticated;
GRANT ALL ON public.fluency_recordings TO service_role;
ALTER TABLE public.fluency_recordings ENABLE ROW LEVEL SECURITY;
CREATE POLICY fluency_recordings_owner_all ON public.fluency_recordings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX fluency_recordings_user_created_idx ON public.fluency_recordings(user_id, created_at DESC);
CREATE INDEX fluency_sessions_user_completed_idx ON public.fluency_sessions(user_id, completed_at DESC);
