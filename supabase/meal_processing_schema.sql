-- ============================================================
-- RYTM v1 – Meal Processing Pipeline Schema
-- Pipeline version: v1.0
-- Created: 2026-02-17
-- ============================================================
-- This migration creates three tables:
--   1. meal_processing_runs  – one row per (meal, pipeline_version)
--   2. meal_items_v1         – extracted+estimated line items
--   3. food_cache_v1         – reusable macro lookups
-- Plus RLS policies so each user can only see their own data.
-- ============================================================


-- ==========================================
-- 1. meal_processing_runs
-- ==========================================

CREATE TABLE IF NOT EXISTS meal_processing_runs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id           uuid        NOT NULL REFERENCES meal_logs(id) ON DELETE CASCADE,
  user_id           uuid        NOT NULL,
  pipeline_version  text        NOT NULL,
  status            text        NOT NULL DEFAULT 'queued',
  model             text,
  input_modes       text[],
  confidence_score  integer,
  confidence_reasons jsonb,
  llm_comment       text,
  improvement_tips  jsonb,
  totals            jsonb,
  tokens_in         integer,
  tokens_out        integer,
  cost_usd          numeric,
  error             text,
  created_at        timestamptz DEFAULT now(),
  processed_at      timestamptz
);

-- Enforce one run per (meal, pipeline_version)
CREATE UNIQUE INDEX IF NOT EXISTS idx_meal_version_unique
  ON meal_processing_runs(meal_id, pipeline_version);

-- Fast user-level queries (dashboard, aggregations)
CREATE INDEX IF NOT EXISTS idx_meal_processing_user
  ON meal_processing_runs(user_id);


-- ==========================================
-- 2. meal_items_v1
-- ==========================================

CREATE TABLE IF NOT EXISTS meal_items_v1 (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid    NOT NULL REFERENCES meal_processing_runs(id) ON DELETE CASCADE,
  name_raw        text,
  name_normalized text,
  portion_text    text,
  qty             numeric,
  unit            text,
  item_confidence numeric,
  kcal            numeric,
  protein_g       numeric,
  carbs_g         numeric,
  fat_g           numeric,
  sugar_g         numeric,
  source          text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meal_items_run
  ON meal_items_v1(run_id);


-- ==========================================
-- 3. food_cache_v1
-- ==========================================

CREATE TABLE IF NOT EXISTS food_cache_v1 (
  name_normalized text        PRIMARY KEY,
  macros_basis    text,
  kcal            numeric,
  protein_g       numeric,
  carbs_g         numeric,
  fat_g           numeric,
  sugar_g         numeric,
  serving_notes   text,
  source          text,
  updated_at      timestamptz DEFAULT now()
);


-- ============================================================
-- RLS — users may only touch their own rows
-- ============================================================

ALTER TABLE meal_processing_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_items_v1        ENABLE ROW LEVEL SECURITY;

-- meal_processing_runs: direct user_id check
CREATE POLICY "user access runs"
  ON meal_processing_runs
  FOR ALL
  USING (user_id = auth.uid());

-- meal_items_v1: check via parent run's user_id
CREATE POLICY "user access items"
  ON meal_items_v1
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM meal_processing_runs
      WHERE meal_processing_runs.id = meal_items_v1.run_id
        AND meal_processing_runs.user_id = auth.uid()
    )
  );

-- food_cache_v1 is a shared lookup table — allow authenticated reads
ALTER TABLE food_cache_v1 ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read cache"
  ON food_cache_v1
  FOR SELECT
  USING (auth.role() = 'authenticated');
