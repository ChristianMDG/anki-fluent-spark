-- Add SM-2 Spaced Repetition System (SRS) columns to cards table
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS ease_factor double precision NOT NULL DEFAULT 2.5;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS interval_days integer NOT NULL DEFAULT 0;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS repetitions integer NOT NULL DEFAULT 0;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS due_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS last_reviewed_at timestamptz;

-- Create index for faster due queue retrieval sorted by due_at
CREATE INDEX IF NOT EXISTS cards_user_due_idx ON public.cards (user_id, due_at ASC);
