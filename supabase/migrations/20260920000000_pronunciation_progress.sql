-- Table for per-user pronunciation category progress tracking
CREATE TABLE IF NOT EXISTS public.pronunciation_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL,
  clear_count integer NOT NULL DEFAULT 0,
  confusable_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique index per (user_id, category)
CREATE UNIQUE INDEX IF NOT EXISTS pronunciation_progress_user_cat_idx
  ON public.pronunciation_progress(user_id, category);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pronunciation_progress TO authenticated;
GRANT ALL ON public.pronunciation_progress TO service_role;

ALTER TABLE public.pronunciation_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pronunciation_progress_owner_all" ON public.pronunciation_progress
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
