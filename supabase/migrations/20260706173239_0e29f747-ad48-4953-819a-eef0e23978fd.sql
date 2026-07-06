
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.daily_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  target_count integer NOT NULL DEFAULT 10,
  date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_goals TO authenticated;
GRANT ALL ON public.daily_goals TO service_role;

ALTER TABLE public.daily_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY daily_goals_owner_all ON public.daily_goals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
