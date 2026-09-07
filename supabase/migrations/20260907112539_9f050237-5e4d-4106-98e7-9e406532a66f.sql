ALTER TABLE public.cards
  ADD COLUMN IF NOT EXISTS card_state text NOT NULL DEFAULT 'new' CHECK (card_state IN ('new','learning','review','relearning')),
  ADD COLUMN IF NOT EXISTS learning_step integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ease_factor numeric NOT NULL DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS interval_days numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS repetitions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS due_at timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_reviewed_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS cards_due_idx ON public.cards(user_id, due_at);