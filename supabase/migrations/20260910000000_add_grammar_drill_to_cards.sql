-- Add last_grammar_drill_at column to cards table for tracking grammar drill frequency
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS last_grammar_drill_at timestamptz;

-- Index for ordering cards by user and least recently grammar-drilled
CREATE INDEX IF NOT EXISTS cards_user_grammar_drill_idx ON public.cards (user_id, last_grammar_drill_at ASC NULLS FIRST);
