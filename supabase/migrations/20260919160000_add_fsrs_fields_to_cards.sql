-- Migration: Add FSRS native scheduling fields to cards table
-- Deprecates SM-2 fields: ease_factor, interval_days, repetitions, card_state, learning_step

ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS fsrs_stability double precision;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS fsrs_difficulty double precision;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS fsrs_state text DEFAULT 'new';
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS fsrs_step integer;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS fsrs_last_review timestamptz;

-- Constraint to restrict fsrs_state values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cards_fsrs_state_check'
  ) THEN
    ALTER TABLE public.cards ADD CONSTRAINT cards_fsrs_state_check
      CHECK (fsrs_state IN ('new', 'learning', 'review', 'relearning'));
  END IF;
END $$;
