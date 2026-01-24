-- Update daily_checkins table for new check-in questions

-- Add new columns for the expanded check-in
ALTER TABLE daily_checkins
ADD COLUMN IF NOT EXISTS coping_capacity_score smallint,
ADD COLUMN IF NOT EXISTS stress_unexpected_score smallint,
ADD COLUMN IF NOT EXISTS mood_stability_score smallint;

-- Drop columns we no longer need
ALTER TABLE daily_checkins
DROP COLUMN IF EXISTS stress_present,
DROP COLUMN IF EXISTS stress_sources,
DROP COLUMN IF EXISTS stress_coping;

-- Add check constraints to ensure VAS scores are between 0-100
ALTER TABLE daily_checkins
DROP CONSTRAINT IF EXISTS daily_checkins_coping_capacity_score_check,
DROP CONSTRAINT IF EXISTS daily_checkins_stress_unexpected_score_check,
DROP CONSTRAINT IF EXISTS daily_checkins_mood_stability_score_check;

ALTER TABLE daily_checkins
ADD CONSTRAINT daily_checkins_coping_capacity_score_check CHECK (coping_capacity_score >= 0 AND coping_capacity_score <= 100),
ADD CONSTRAINT daily_checkins_stress_unexpected_score_check CHECK (stress_unexpected_score >= 0 AND stress_unexpected_score <= 100),
ADD CONSTRAINT daily_checkins_mood_stability_score_check CHECK (mood_stability_score >= 0 AND mood_stability_score <= 100);

-- Update existing constraints to use 0-100 range for VAS
ALTER TABLE daily_checkins
DROP CONSTRAINT IF EXISTS daily_checkins_mood_score_check,
DROP CONSTRAINT IF EXISTS daily_checkins_stress_score_check,
DROP CONSTRAINT IF EXISTS daily_checkins_energy_score_check,
DROP CONSTRAINT IF EXISTS daily_checkins_focus_score_check,
DROP CONSTRAINT IF EXISTS daily_checkins_sleep_quality_check,
DROP CONSTRAINT IF EXISTS daily_checkins_workload_score_check,
DROP CONSTRAINT IF EXISTS daily_checkins_social_score_check;

ALTER TABLE daily_checkins
ADD CONSTRAINT daily_checkins_mood_score_check CHECK (mood_score >= 0 AND mood_score <= 100),
ADD CONSTRAINT daily_checkins_stress_score_check CHECK (stress_score >= 0 AND stress_score <= 100),
ADD CONSTRAINT daily_checkins_energy_score_check CHECK (energy_score >= 0 AND energy_score <= 100),
ADD CONSTRAINT daily_checkins_focus_score_check CHECK (focus_score >= 0 AND focus_score <= 100),
ADD CONSTRAINT daily_checkins_sleep_quality_check CHECK (sleep_quality >= 0 AND sleep_quality <= 100),
ADD CONSTRAINT daily_checkins_workload_score_check CHECK (workload_score >= 0 AND workload_score <= 100),
ADD CONSTRAINT daily_checkins_social_score_check CHECK (social_score >= 0 AND social_score <= 100);
