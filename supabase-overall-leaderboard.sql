-- =====================================================
-- OVERALL LEADERBOARD SCHEMA
-- Tracks weekly competition results and computes
-- cumulative "overall points" across all weeks.
-- Run this in Supabase SQL Editor.
-- =====================================================

-- 1. Scoring function ─────────────────────────────────
-- Maps a weekly rank to points.
-- Top-10 uses a hand-tuned array; ranks 11-35 get a
-- decreasing score; rank 36+ gets 0.

CREATE OR REPLACE FUNCTION public.rytm_weekly_points(rank_pos INT)
RETURNS INT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN rank_pos = 1  THEN 100
    WHEN rank_pos = 2  THEN 92
    WHEN rank_pos = 3  THEN 85
    WHEN rank_pos = 4  THEN 79
    WHEN rank_pos = 5  THEN 73
    WHEN rank_pos = 6  THEN 68
    WHEN rank_pos = 7  THEN 63
    WHEN rank_pos = 8  THEN 58
    WHEN rank_pos = 9  THEN 54
    WHEN rank_pos = 10 THEN 50
    WHEN rank_pos >= 11 THEN GREATEST(0, 70 - 2 * rank_pos)
    ELSE 0
  END;
$$;

COMMENT ON FUNCTION public.rytm_weekly_points IS
  'Convert a weekly leaderboard rank (1-based) into overall points.';


-- 2. Weekly results table ─────────────────────────────
-- One row per user per completed week.
-- `rank` is their finishing position; `points` is auto-
-- computed by a trigger.

CREATE TABLE IF NOT EXISTS public.weekly_results (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  week_id     UUID NOT NULL REFERENCES public.leaderboard_weeks(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rank        INT  NOT NULL CHECK (rank >= 1),
  points      INT  NOT NULL DEFAULT 0,
  metric_key  TEXT,                     -- e.g. 'steps', carried from the week
  metric_value NUMERIC,                 -- their actual metric value that week
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL,

  UNIQUE (week_id, user_id)             -- one result per user per week
);

CREATE INDEX IF NOT EXISTS idx_weekly_results_user
  ON public.weekly_results (user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_results_week
  ON public.weekly_results (week_id);

COMMENT ON TABLE public.weekly_results IS
  'Stores final weekly competition results. Points are auto-filled by trigger.';


-- 3. Trigger: auto-fill points from rank ──────────────

CREATE OR REPLACE FUNCTION public.trg_weekly_results_set_points()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.points := public.rytm_weekly_points(NEW.rank);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_weekly_points ON public.weekly_results;
CREATE TRIGGER set_weekly_points
  BEFORE INSERT OR UPDATE OF rank ON public.weekly_results
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_weekly_results_set_points();


-- 4. Overall leaderboard view ─────────────────────────
-- Aggregates all weekly_results into a cumulative
-- ranking. Also counts how many weeks each user
-- has competed and their best single-week finish.

CREATE OR REPLACE VIEW public.overall_leaderboard AS
SELECT
  wr.user_id,
  p.first_name,
  p.last_name,
  COALESCE(TRIM(CONCAT(p.first_name, ' ', p.last_name)), 'Unknown') AS full_name,
  SUM(wr.points)::INT                        AS total_points,
  COUNT(wr.week_id)::INT                     AS weeks_competed,
  MIN(wr.rank)::INT                          AS best_finish,
  RANK() OVER (ORDER BY SUM(wr.points) DESC) AS overall_rank
FROM public.weekly_results wr
JOIN public.profiles p ON p.user_id = wr.user_id
GROUP BY wr.user_id, p.first_name, p.last_name
ORDER BY total_points DESC;

COMMENT ON VIEW public.overall_leaderboard IS
  'Cumulative overall leaderboard computed from weekly_results.';


-- 5. Helper: latest week points per user ──────────────
-- Useful for showing "+63 this week" deltas.

CREATE OR REPLACE VIEW public.latest_week_points AS
SELECT
  wr.user_id,
  wr.points  AS latest_points,
  lw.week_start,
  lw.week_end
FROM public.weekly_results wr
JOIN public.leaderboard_weeks lw ON lw.id = wr.week_id
WHERE lw.week_start = (
  SELECT MAX(lw2.week_start)
  FROM public.leaderboard_weeks lw2
  JOIN public.weekly_results wr2 ON wr2.week_id = lw2.id
);


-- 6. RLS policies ─────────────────────────────────────

ALTER TABLE public.weekly_results ENABLE ROW LEVEL SECURITY;

-- Everyone can read (leaderboard is public among authenticated users)
DROP POLICY IF EXISTS "Weekly results are viewable by everyone" ON public.weekly_results;
CREATE POLICY "Weekly results are viewable by everyone"
  ON public.weekly_results
  FOR SELECT
  TO authenticated
  USING (true);

-- Only service role / admin can insert/update/delete
DROP POLICY IF EXISTS "Only admins can insert weekly results" ON public.weekly_results;
CREATE POLICY "Only admins can insert weekly results"
  ON public.weekly_results
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Only admins can update weekly results" ON public.weekly_results;
CREATE POLICY "Only admins can update weekly results"
  ON public.weekly_results
  FOR UPDATE
  TO service_role
  USING (true);

DROP POLICY IF EXISTS "Only admins can delete weekly results" ON public.weekly_results;
CREATE POLICY "Only admins can delete weekly results"
  ON public.weekly_results
  FOR DELETE
  TO service_role
  USING (true);


-- =====================================================
-- EXAMPLE QUERIES
-- =====================================================

-- ── Insert weekly results (manual entry after a week ends) ──
--
-- Suppose week_id = 'aaaaaaaa-...' ended, and the final
-- rankings from leaderboard_user_week_stats are known.
-- You can bulk-insert from the stats table:
--
--   INSERT INTO public.weekly_results (week_id, user_id, rank, metric_key, metric_value)
--   SELECT
--     '<WEEK_UUID>'::UUID,
--     sub.app_user_id,
--     sub.rn,
--     '<metric_key>',
--     sub.value
--   FROM (
--     SELECT
--       app_user_id,
--       value,
--       ROW_NUMBER() OVER (ORDER BY value DESC) AS rn
--     FROM public.leaderboard_user_week_stats
--     WHERE week_id = '<WEEK_UUID>'
--       AND metric_key = '<metric_key>'
--   ) sub;
--
-- The trigger auto-fills `points` from `rank`.

-- ── Or insert a single user manually ──
--
--   INSERT INTO public.weekly_results (week_id, user_id, rank, metric_key, metric_value)
--   VALUES ('week-uuid', 'user-uuid', 1, 'steps', 87432);

-- ── Fetch overall leaderboard (top 10) ──
--
--   SELECT * FROM public.overall_leaderboard
--   ORDER BY overall_rank
--   LIMIT 10;

-- ── Fetch full overall leaderboard with latest-week delta ──
--
--   SELECT
--     ol.*,
--     COALESCE(lwp.latest_points, 0) AS points_this_week
--   FROM public.overall_leaderboard ol
--   LEFT JOIN public.latest_week_points lwp ON lwp.user_id = ol.user_id
--   ORDER BY ol.overall_rank;

-- =====================================================
-- DONE
-- =====================================================
