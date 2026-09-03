
-- CEFR level enum
DO $$ BEGIN
  CREATE TYPE public.cefr_level AS ENUM ('A1','A2','B1','B2','C1','C2');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- learner_profile: one row per user (lazy-created on first Fluency visit)
CREATE TABLE IF NOT EXISTS public.learner_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  current_level public.cefr_level NOT NULL DEFAULT 'B1',
  level_updated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.learner_profile TO authenticated;
GRANT ALL ON public.learner_profile TO service_role;
ALTER TABLE public.learner_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "learner_profile_owner_all" ON public.learner_profile
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- learner_weak_points: growth areas detected from feedback
CREATE TABLE IF NOT EXISTS public.learner_weak_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tag text NOT NULL,
  example text NOT NULL DEFAULT '',
  occurrences int NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.learner_weak_points TO authenticated;
GRANT ALL ON public.learner_weak_points TO service_role;
ALTER TABLE public.learner_weak_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "learner_weak_points_owner_all" ON public.learner_weak_points
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS learner_weak_points_user_tag_idx
  ON public.learner_weak_points(user_id, tag);

-- Lazy-init: insert default profile row if missing (mirrors ensure_journey_cells pattern).
-- Called by the client on first Fluency visit; ON CONFLICT DO NOTHING is idempotent.
CREATE OR REPLACE FUNCTION public.ensure_learner_profile(_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF _user IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.learner_profile(user_id)
  VALUES (_user)
  ON CONFLICT (user_id) DO NOTHING;
END; $$;

GRANT EXECUTE ON FUNCTION public.ensure_learner_profile(uuid) TO authenticated;
