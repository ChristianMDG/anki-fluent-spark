-- Migration: add book_level_estimates table for cached AI level estimates and book previews
CREATE TABLE IF NOT EXISTS public.book_level_estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gutenberg_book_id INT UNIQUE NOT NULL,
  estimated_level TEXT NOT NULL,
  confidence TEXT DEFAULT 'medium',
  description TEXT,
  word_count INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.book_level_estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read on book_level_estimates"
  ON public.book_level_estimates
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated write on book_level_estimates"
  ON public.book_level_estimates
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
