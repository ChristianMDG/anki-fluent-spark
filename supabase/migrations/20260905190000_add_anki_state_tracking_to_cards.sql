-- Add Anki state tracking columns to cards table
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS card_state text NOT NULL DEFAULT 'new';
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS learning_step integer NOT NULL DEFAULT 0;

-- Optional constraint to restrict card_state values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cards_card_state_check'
  ) THEN
    ALTER TABLE public.cards ADD CONSTRAINT cards_card_state_check 
      CHECK (card_state IN ('new', 'learning', 'review', 'relearning'));
  END IF;
END $$;
