CREATE TABLE public.content_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  platform text NOT NULL DEFAULT 'other' CHECK (platform IN ('facebook','youtube','other')),
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_sources TO authenticated;
GRANT ALL ON public.content_sources TO service_role;

ALTER TABLE public.content_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_sources_owner_all" ON public.content_sources
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX content_sources_user_idx ON public.content_sources(user_id, created_at DESC);