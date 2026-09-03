ALTER TABLE public.shadowing_videos DROP CONSTRAINT shadowing_videos_source_type_check;
ALTER TABLE public.shadowing_videos ADD CONSTRAINT shadowing_videos_source_type_check CHECK (source_type = ANY (ARRAY['youtube'::text, 'upload'::text, 'facebook'::text]));
ALTER TABLE public.shadowing_videos ADD COLUMN IF NOT EXISTS source_url text;