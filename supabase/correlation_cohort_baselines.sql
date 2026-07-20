-- Cached cohort-average Spearman heatmaps for distinctive-edge computation.
-- Built by experiments/build_correlation_cohort_baseline.py (service role).

CREATE TABLE IF NOT EXISTS public.correlation_cohort_baselines1 (
  baseline_id uuid NOT NULL DEFAULT gen_random_uuid(),
  baseline_version text NOT NULL DEFAULT 'correlation_cohort_v1',
  feature_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  mean_rho_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  n_users_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  min_users_per_cell integer NOT NULL DEFAULT 3,
  users_included integer NOT NULL DEFAULT 0,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT correlation_cohort_baselines1_pkey PRIMARY KEY (baseline_id)
);

CREATE INDEX IF NOT EXISTS idx_correlation_cohort_baselines1_created
  ON public.correlation_cohort_baselines1 USING btree (created_at DESC);

ALTER TABLE public.correlation_cohort_baselines1 ENABLE ROW LEVEL SECURITY;

-- No user-facing SELECT policy: service role only (baselines are shared artifacts).

CREATE OR REPLACE FUNCTION public.install_correlation_cohort_baselines_schema()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  CREATE TABLE IF NOT EXISTS public.correlation_cohort_baselines1 (
    baseline_id uuid NOT NULL DEFAULT gen_random_uuid(),
    baseline_version text NOT NULL DEFAULT 'correlation_cohort_v1',
    feature_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
    mean_rho_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    n_users_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    min_users_per_cell integer NOT NULL DEFAULT 3,
    users_included integer NOT NULL DEFAULT 0,
    metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT correlation_cohort_baselines1_pkey PRIMARY KEY (baseline_id)
  );

  CREATE INDEX IF NOT EXISTS idx_correlation_cohort_baselines1_created
    ON public.correlation_cohort_baselines1 USING btree (created_at DESC);

  ALTER TABLE public.correlation_cohort_baselines1 ENABLE ROW LEVEL SECURITY;
END;
$$;

GRANT EXECUTE ON FUNCTION public.install_correlation_cohort_baselines_schema() TO service_role;
