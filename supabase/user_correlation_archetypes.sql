-- Correlation-heatmap behavioral archetypes (Spearman + LLM interpretation).
-- Applied manually or via python/coach/apply_correlation_archetype_schema.py

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'correlation_archetype_status_v1'
  ) THEN
    CREATE TYPE public.correlation_archetype_status_v1 AS ENUM (
      'running',
      'active',
      'superseded',
      'failed',
      'skipped',
      'rejected'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_correlation_archetypes1 (
  archetype_id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status public.correlation_archetype_status_v1 NOT NULL DEFAULT 'running',
  profile_version text NOT NULL DEFAULT 'correlation_archetype_v1',
  archetype_title text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  what_heatmap_shows text NOT NULL DEFAULT '',
  what_it_reflects text NOT NULL DEFAULT '',
  core_insight text NOT NULL DEFAULT '',
  strength text NOT NULL DEFAULT '',
  primary_coaching_rule text NOT NULL DEFAULT '',
  archetype_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  heatmap_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  trusted_edges_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  distinctive_edges_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  correlation_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality_evaluation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_window_start date NULL,
  data_window_end date NULL,
  days_used integer NOT NULL DEFAULT 0,
  run_trigger text NOT NULL DEFAULT 'manual',
  error_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz NULL,
  CONSTRAINT user_correlation_archetypes1_pkey PRIMARY KEY (archetype_id),
  CONSTRAINT user_correlation_archetypes1_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles (user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_correlation_archetypes1_user_created
  ON public.user_correlation_archetypes1 USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_correlation_archetypes1_user_status
  ON public.user_correlation_archetypes1 USING btree (user_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_correlation_archetypes1_one_active
  ON public.user_correlation_archetypes1 (user_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_correlation_archetypes1_one_running
  ON public.user_correlation_archetypes1 (user_id)
  WHERE status = 'running';

ALTER TABLE public.user_correlation_archetypes1 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own correlation archetypes"
  ON public.user_correlation_archetypes1;

CREATE POLICY "Users can view their own correlation archetypes"
  ON public.user_correlation_archetypes1
  FOR SELECT
  USING (auth.uid() = user_id);

-- Atomic claim of a running job
CREATE OR REPLACE FUNCTION public.claim_correlation_archetype_job(
  p_user_id uuid,
  p_run_trigger text DEFAULT 'manual'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_archetype_id uuid;
  v_lock_key bigint;
BEGIN
  v_lock_key := ('x' || substr(md5('corr:' || p_user_id::text), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF EXISTS (
    SELECT 1
    FROM public.user_correlation_archetypes1
    WHERE user_id = p_user_id
      AND status = 'running'
  ) THEN
    RAISE EXCEPTION 'correlation_archetype_job_already_running'
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO public.user_correlation_archetypes1 (
    user_id,
    status,
    profile_version,
    run_trigger
  ) VALUES (
    p_user_id,
    'running',
    'correlation_archetype_v1',
    COALESCE(NULLIF(p_run_trigger, ''), 'manual')
  )
  RETURNING archetype_id INTO v_archetype_id;

  RETURN v_archetype_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_correlation_archetype_job(uuid, text) TO service_role;

-- Atomic promotion: supersede actives + activate candidate in one transaction
CREATE OR REPLACE FUNCTION public.promote_user_correlation_archetype(
  p_user_id uuid,
  p_archetype_id uuid,
  p_update_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_owner uuid;
  v_lock_key bigint;
  v_now timestamptz := now();
BEGIN
  v_lock_key := ('x' || substr(md5('corr:' || p_user_id::text), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT user_id, status::text
    INTO v_owner, v_status
  FROM public.user_correlation_archetypes1
  WHERE archetype_id = p_archetype_id
  FOR UPDATE;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'correlation_archetype_not_found';
  END IF;

  IF v_owner <> p_user_id THEN
    RAISE EXCEPTION 'correlation_archetype_user_mismatch';
  END IF;

  IF v_status NOT IN ('running') THEN
    RAISE EXCEPTION 'correlation_archetype_not_promotable status=%', v_status;
  END IF;

  UPDATE public.user_correlation_archetypes1
  SET
    status = 'superseded',
    superseded_at = v_now
  WHERE user_id = p_user_id
    AND status = 'active'
    AND archetype_id <> p_archetype_id;

  UPDATE public.user_correlation_archetypes1
  SET
    status = 'active',
    profile_version = COALESCE(p_update_payload->>'profile_version', profile_version),
    archetype_title = COALESCE(p_update_payload->>'archetype_title', archetype_title),
    summary = COALESCE(p_update_payload->>'summary', summary),
    what_heatmap_shows = COALESCE(p_update_payload->>'what_heatmap_shows', what_heatmap_shows),
    what_it_reflects = COALESCE(p_update_payload->>'what_it_reflects', what_it_reflects),
    core_insight = COALESCE(p_update_payload->>'core_insight', core_insight),
    strength = COALESCE(p_update_payload->>'strength', strength),
    primary_coaching_rule = COALESCE(
      p_update_payload->>'primary_coaching_rule',
      primary_coaching_rule
    ),
    archetype_json = COALESCE(p_update_payload->'archetype_json', archetype_json),
    heatmap_json = COALESCE(p_update_payload->'heatmap_json', heatmap_json),
    trusted_edges_json = COALESCE(p_update_payload->'trusted_edges_json', trusted_edges_json),
    distinctive_edges_json = COALESCE(
      p_update_payload->'distinctive_edges_json',
      distinctive_edges_json
    ),
    correlation_metadata_json = COALESCE(
      p_update_payload->'correlation_metadata_json',
      correlation_metadata_json
    ),
    quality_evaluation_json = COALESCE(
      p_update_payload->'quality_evaluation_json',
      quality_evaluation_json
    ),
    days_used = COALESCE((p_update_payload->>'days_used')::integer, days_used),
    data_window_start = CASE
      WHEN p_update_payload ? 'data_window_start'
        THEN NULLIF(p_update_payload->>'data_window_start', '')::date
      ELSE data_window_start
    END,
    data_window_end = CASE
      WHEN p_update_payload ? 'data_window_end'
        THEN NULLIF(p_update_payload->>'data_window_end', '')::date
      ELSE data_window_end
    END,
    error_json = COALESCE(p_update_payload->'error_json', '{}'::jsonb),
    superseded_at = NULL
  WHERE archetype_id = p_archetype_id
    AND user_id = p_user_id;

  RETURN p_archetype_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.promote_user_correlation_archetype(uuid, uuid, jsonb) TO service_role;

-- Idempotent installer
CREATE OR REPLACE FUNCTION public.install_user_correlation_archetypes_schema()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'correlation_archetype_status_v1'
  ) THEN
    CREATE TYPE public.correlation_archetype_status_v1 AS ENUM (
      'running',
      'active',
      'superseded',
      'failed',
      'skipped',
      'rejected'
    );
  END IF;

  CREATE TABLE IF NOT EXISTS public.user_correlation_archetypes1 (
    archetype_id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    status public.correlation_archetype_status_v1 NOT NULL DEFAULT 'running',
    profile_version text NOT NULL DEFAULT 'correlation_archetype_v1',
    archetype_title text NOT NULL DEFAULT '',
    summary text NOT NULL DEFAULT '',
    what_heatmap_shows text NOT NULL DEFAULT '',
    what_it_reflects text NOT NULL DEFAULT '',
    core_insight text NOT NULL DEFAULT '',
    strength text NOT NULL DEFAULT '',
    primary_coaching_rule text NOT NULL DEFAULT '',
    archetype_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    heatmap_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    trusted_edges_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    distinctive_edges_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    correlation_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    quality_evaluation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    data_window_start date NULL,
    data_window_end date NULL,
    days_used integer NOT NULL DEFAULT 0,
    run_trigger text NOT NULL DEFAULT 'manual',
    error_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    superseded_at timestamptz NULL,
    CONSTRAINT user_correlation_archetypes1_pkey PRIMARY KEY (archetype_id),
    CONSTRAINT user_correlation_archetypes1_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles (user_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_user_correlation_archetypes1_user_created
    ON public.user_correlation_archetypes1 USING btree (user_id, created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_user_correlation_archetypes1_user_status
    ON public.user_correlation_archetypes1 USING btree (user_id, status);

  CREATE UNIQUE INDEX IF NOT EXISTS uq_user_correlation_archetypes1_one_active
    ON public.user_correlation_archetypes1 (user_id)
    WHERE status = 'active';

  CREATE UNIQUE INDEX IF NOT EXISTS uq_user_correlation_archetypes1_one_running
    ON public.user_correlation_archetypes1 (user_id)
    WHERE status = 'running';

  ALTER TABLE public.user_correlation_archetypes1 ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "Users can view their own correlation archetypes"
    ON public.user_correlation_archetypes1;

  CREATE POLICY "Users can view their own correlation archetypes"
    ON public.user_correlation_archetypes1
    FOR SELECT
    USING (auth.uid() = user_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.install_user_correlation_archetypes_schema() TO service_role;
