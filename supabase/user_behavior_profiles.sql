-- Versioned per-user behavioral profiles derived from clustering + LLM interpretation.
-- Applied manually or via python/coach/apply_behavior_profile_schema.py

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'behavior_profile_status_v1'
  ) THEN
    CREATE TYPE public.behavior_profile_status_v1 AS ENUM (
      'running',
      'active',
      'superseded',
      'failed',
      'skipped'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_behavior_profiles1 (
  profile_id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status public.behavior_profile_status_v1 NOT NULL DEFAULT 'running',
  profile_version text NOT NULL DEFAULT 'cluster_profile_v1',
  summary text NOT NULL DEFAULT '',
  cluster_interpretations_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  primary_coaching_rule text NOT NULL DEFAULT '',
  profile_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  cluster_stats_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  clustering_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_window_start date NULL,
  data_window_end date NULL,
  days_used integer NOT NULL DEFAULT 0,
  run_trigger text NOT NULL DEFAULT 'manual',
  error_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz NULL,
  CONSTRAINT user_behavior_profiles1_pkey PRIMARY KEY (profile_id),
  CONSTRAINT user_behavior_profiles1_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_behavior_profiles1_user_created
  ON public.user_behavior_profiles1 USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_behavior_profiles1_user_status
  ON public.user_behavior_profiles1 USING btree (user_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_behavior_profiles1_one_active
  ON public.user_behavior_profiles1 (user_id)
  WHERE status = 'active';

ALTER TABLE public.user_behavior_profiles1 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own behavior profiles"
  ON public.user_behavior_profiles1;

CREATE POLICY "Users can view their own behavior profiles"
  ON public.user_behavior_profiles1
  FOR SELECT
  USING (auth.uid() = user_id);

-- Idempotent installer callable from python/coach/apply_behavior_profile_schema.py
-- via Supabase REST (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
CREATE OR REPLACE FUNCTION public.install_user_behavior_profiles_schema()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'behavior_profile_status_v1'
  ) THEN
    CREATE TYPE public.behavior_profile_status_v1 AS ENUM (
      'running',
      'active',
      'superseded',
      'failed',
      'skipped'
    );
  END IF;

  CREATE TABLE IF NOT EXISTS public.user_behavior_profiles1 (
    profile_id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    status public.behavior_profile_status_v1 NOT NULL DEFAULT 'running',
    profile_version text NOT NULL DEFAULT 'cluster_profile_v1',
    summary text NOT NULL DEFAULT '',
    cluster_interpretations_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    primary_coaching_rule text NOT NULL DEFAULT '',
    profile_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    cluster_stats_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    clustering_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    data_window_start date NULL,
    data_window_end date NULL,
    days_used integer NOT NULL DEFAULT 0,
    run_trigger text NOT NULL DEFAULT 'manual',
    error_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    superseded_at timestamptz NULL,
    CONSTRAINT user_behavior_profiles1_pkey PRIMARY KEY (profile_id),
    CONSTRAINT user_behavior_profiles1_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles (user_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_user_behavior_profiles1_user_created
    ON public.user_behavior_profiles1 USING btree (user_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_user_behavior_profiles1_user_status
    ON public.user_behavior_profiles1 USING btree (user_id, status);

  CREATE UNIQUE INDEX IF NOT EXISTS uq_user_behavior_profiles1_one_active
    ON public.user_behavior_profiles1 (user_id)
    WHERE status = 'active';

  ALTER TABLE public.user_behavior_profiles1 ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "Users can view their own behavior profiles"
    ON public.user_behavior_profiles1;

  CREATE POLICY "Users can view their own behavior profiles"
    ON public.user_behavior_profiles1
    FOR SELECT
    USING (auth.uid() = user_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.install_user_behavior_profiles_schema() TO service_role;
