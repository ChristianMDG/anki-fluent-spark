-- Table for per-user reading preferences
CREATE TABLE IF NOT EXISTS public.reading_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  font_size text NOT NULL DEFAULT 'M',
  line_spacing text NOT NULL DEFAULT 'comfortable',
  theme text NOT NULL DEFAULT 'sepia',
  read_aloud_rate real NOT NULL DEFAULT 1.0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reading_preferences TO authenticated;
GRANT ALL ON public.reading_preferences TO service_role;

ALTER TABLE public.reading_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reading_preferences_owner_all" ON public.reading_preferences
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Table for user book bookmarks
CREATE TABLE IF NOT EXISTS public.reading_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gutenberg_book_id integer NOT NULL,
  chunk_index integer NOT NULL,
  label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reading_bookmarks_user_book_idx
  ON public.reading_bookmarks(user_id, gutenberg_book_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reading_bookmarks TO authenticated;
GRANT ALL ON public.reading_bookmarks TO service_role;

ALTER TABLE public.reading_bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reading_bookmarks_owner_all" ON public.reading_bookmarks
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
