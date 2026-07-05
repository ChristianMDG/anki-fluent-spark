
-- CARDS
CREATE TABLE public.cards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  ipa TEXT DEFAULT '',
  pos TEXT DEFAULT '',
  level TEXT DEFAULT '',
  definition TEXT DEFAULT '',
  french TEXT DEFAULT '',
  grammar TEXT DEFAULT '',
  examples TEXT DEFAULT '',
  cloze TEXT DEFAULT '',
  speaking_q1 TEXT DEFAULT '',
  speaking_a1 TEXT DEFAULT '',
  speaking_q2 TEXT DEFAULT '',
  speaking_a2 TEXT DEFAULT '',
  exported BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cards TO authenticated;
GRANT ALL ON public.cards TO service_role;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cards_owner_all" ON public.cards FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX cards_user_created_idx ON public.cards(user_id, created_at DESC);

-- LESSONS
CREATE TABLE public.lessons (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE UNIQUE,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lessons TO authenticated;
GRANT ALL ON public.lessons TO service_role;
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lessons_owner_all" ON public.lessons FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- SHADOWING VIDEOS
CREATE TABLE public.shadowing_videos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('youtube', 'upload')),
  youtube_id TEXT,
  storage_path TEXT,
  title TEXT DEFAULT '',
  thumbnail_url TEXT DEFAULT '',
  duration_seconds INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shadowing_videos TO authenticated;
GRANT ALL ON public.shadowing_videos TO service_role;
ALTER TABLE public.shadowing_videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shadowing_videos_owner_all" ON public.shadowing_videos FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX shadowing_videos_user_created_idx ON public.shadowing_videos(user_id, created_at DESC);

-- SHADOWING NOTES
CREATE TABLE public.shadowing_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES public.shadowing_videos(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  context TEXT DEFAULT '',
  card_id UUID REFERENCES public.cards(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shadowing_notes TO authenticated;
GRANT ALL ON public.shadowing_notes TO service_role;
ALTER TABLE public.shadowing_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shadowing_notes_owner_all" ON public.shadowing_notes FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX shadowing_notes_video_idx ON public.shadowing_notes(video_id, created_at DESC);

-- Storage bucket policies (bucket created via tool)
CREATE POLICY "shadowing_videos_own_read" ON storage.objects FOR SELECT
  TO authenticated USING (bucket_id = 'shadowing-videos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "shadowing_videos_own_insert" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (bucket_id = 'shadowing-videos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "shadowing_videos_own_update" ON storage.objects FOR UPDATE
  TO authenticated USING (bucket_id = 'shadowing-videos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "shadowing_videos_own_delete" ON storage.objects FOR DELETE
  TO authenticated USING (bucket_id = 'shadowing-videos' AND auth.uid()::text = (storage.foldername(name))[1]);
