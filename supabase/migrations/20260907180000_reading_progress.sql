-- reading_progress: one row per (user, gutenberg book) tracking reading position
CREATE TABLE IF NOT EXISTS public.reading_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gutenberg_book_id integer NOT NULL,
  book_title text NOT NULL DEFAULT '',
  current_chunk_index integer NOT NULL DEFAULT 0,
  total_chunks integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- unique constraint: one progress row per (user, book)
CREATE UNIQUE INDEX IF NOT EXISTS reading_progress_user_book_idx
  ON public.reading_progress(user_id, gutenberg_book_id);

-- index for fast user-level queries
CREATE INDEX IF NOT EXISTS reading_progress_user_idx
  ON public.reading_progress(user_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reading_progress TO authenticated;
GRANT ALL ON public.reading_progress TO service_role;

ALTER TABLE public.reading_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reading_progress_owner_all" ON public.reading_progress
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
