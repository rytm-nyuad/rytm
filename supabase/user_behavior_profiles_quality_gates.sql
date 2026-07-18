-- Behavior profile quality gates + atomic promotion.
-- Apply in Supabase SQL editor after user_behavior_profiles.sql.

-- 1) Extend status enum with rejected / candidate (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'behavior_profile_status_v1'
      AND e.enumlabel = 'rejected'
  ) THEN
    ALTER TYPE public.behavior_profile_status_v1 ADD VALUE 'rejected';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'behavior_profile_status_v1'
      AND e.enumlabel = 'candidate'
  ) THEN
    ALTER TYPE public.behavior_profile_status_v1 ADD VALUE 'candidate';
  END IF;
END $$;

-- 2) Store deterministic quality evaluation for all outcomes
ALTER TABLE public.user_behavior_profiles1
  ADD COLUMN IF NOT EXISTS quality_evaluation_json jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.user_behavior_profiles1.quality_evaluation_json IS
  'Deterministic clustering quality gates (silhouette, stability, sizes, warnings, thresholds).';

-- 3) At most one running job per user (serialize claim/insert)
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_behavior_profiles1_one_running
  ON public.user_behavior_profiles1 (user_id)
  WHERE status = 'running';

-- Keep existing one-active safeguard
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_behavior_profiles1_one_active
  ON public.user_behavior_profiles1 (user_id)
  WHERE status = 'active';

-- 4) Atomic claim of a running job (advisory lock + insert)
CREATE OR REPLACE FUNCTION public.claim_behavior_profile_job(
  p_user_id uuid,
  p_run_trigger text DEFAULT 'manual'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id uuid;
  v_lock_key bigint;
BEGIN
  -- Serialize concurrent claims for the same user (portable lock key from uuid text)
  v_lock_key := ('x' || substr(md5(p_user_id::text), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF EXISTS (
    SELECT 1
    FROM public.user_behavior_profiles1
    WHERE user_id = p_user_id
      AND status = 'running'
  ) THEN
    RAISE EXCEPTION 'behavior_profile_job_already_running'
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO public.user_behavior_profiles1 (
    user_id,
    status,
    profile_version,
    run_trigger
  ) VALUES (
    p_user_id,
    'running',
    'cluster_profile_v1',
    COALESCE(NULLIF(p_run_trigger, ''), 'manual')
  )
  RETURNING profile_id INTO v_profile_id;

  RETURN v_profile_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_behavior_profile_job(uuid, text) TO service_role;

-- 5) Atomic promotion: supersede actives + activate candidate in one transaction
CREATE OR REPLACE FUNCTION public.promote_user_behavior_profile(
  p_user_id uuid,
  p_profile_id uuid,
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
  v_lock_key := ('x' || substr(md5(p_user_id::text), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT user_id, status::text
    INTO v_owner, v_status
  FROM public.user_behavior_profiles1
  WHERE profile_id = p_profile_id
  FOR UPDATE;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'behavior_profile_not_found';
  END IF;

  IF v_owner <> p_user_id THEN
    RAISE EXCEPTION 'behavior_profile_user_mismatch';
  END IF;

  IF v_status NOT IN ('running', 'candidate') THEN
    RAISE EXCEPTION 'behavior_profile_not_promotable status=%', v_status;
  END IF;

  UPDATE public.user_behavior_profiles1
  SET
    status = 'superseded',
    superseded_at = v_now
  WHERE user_id = p_user_id
    AND status = 'active'
    AND profile_id <> p_profile_id;

  UPDATE public.user_behavior_profiles1
  SET
    status = 'active',
    profile_version = COALESCE(p_update_payload->>'profile_version', profile_version),
    summary = COALESCE(p_update_payload->>'summary', summary),
    cluster_interpretations_json = COALESCE(
      p_update_payload->'cluster_interpretations_json',
      cluster_interpretations_json
    ),
    primary_coaching_rule = COALESCE(
      p_update_payload->>'primary_coaching_rule',
      primary_coaching_rule
    ),
    profile_json = COALESCE(p_update_payload->'profile_json', profile_json),
    cluster_stats_json = COALESCE(p_update_payload->'cluster_stats_json', cluster_stats_json),
    clustering_metadata_json = COALESCE(
      p_update_payload->'clustering_metadata_json',
      clustering_metadata_json
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
  WHERE profile_id = p_profile_id
    AND user_id = p_user_id;

  RETURN p_profile_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.promote_user_behavior_profile(uuid, uuid, jsonb) TO service_role;
