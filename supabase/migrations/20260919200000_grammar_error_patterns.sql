-- Migration: Add grammar_error_patterns table for tracking grammar weak points/patterns
CREATE TABLE IF NOT EXISTS public.grammar_error_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pattern_tag text NOT NULL,
  occurrences integer NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grammar_error_patterns_user_tag_unique UNIQUE (user_id, pattern_tag)
);

ALTER TABLE public.grammar_error_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own grammar error patterns"
  ON public.grammar_error_patterns FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own grammar error patterns"
  ON public.grammar_error_patterns FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own grammar error patterns"
  ON public.grammar_error_patterns FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
