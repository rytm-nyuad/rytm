
create table if not exists daily_checkin_relation2 (
user_id uuid not null references auth.users(id) on delete cascade,
checkin_date date not null,

-- Intrarelations (deterministic)
stress_minus_workload numeric,
stress_minus_coping numeric,
coping_minus_workload numeric,
stress_minus_sleep numeric,
sleep_minus_energy numeric,
focus_minus_energy numeric,
focus_minus_stress numeric,
mood_minus_stress numeric,
mood_minus_energy numeric,
social_minus_mood numeric,
emotion_count int,

created_at timestamptz not null default now(),
primary key (user_id, checkin_date),

-- FK back to raw checkin row (composite match)
constraint fk_checkin_relation2_to_raw
foreign key (user_id, checkin_date)
references daily_checkins(user_id, checkin_date)
on delete cascade
);

create table if not exists journal_summary2 (
user_id uuid not null references auth.users(id) on delete cascade,
date date not null,

-- Structured fields
themes jsonb not null default '[]'::jsonb,
episodic_events jsonb not null default '[]'::jsonb,
stressor_types jsonb not null default '[]'::jsonb,
coping_actions jsonb not null default '[]'::jsonb,
barriers jsonb not null default '[]'::jsonb,
tone_hint text,
risk_flags jsonb not null default '[]'::jsonb,
self_appraisal_style text,
self_efficacy_language text,
goals_conflict_today text,
evidence_quotes jsonb not null default '[]'::jsonb,

-- Tooling / audit
extractor_version text not null default 'journal_summary_v1',
extractor_confidence numeric not null default 0.0 check (extractor_confidence >= 0 and extractor_confidence <= 1),
created_at timestamptz not null default now(),

primary key (user_id, date)
);

create index if not exists idx_journal_summary2_date
on journal_summary2 (date);

create table if not exists public.daily_nutrition2 (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,

  -- Audit: which meal-processing pipeline outputs were used
  aggregation_pipeline_version text not null default 'latest',

  -- Daily macro totals (sum across meals)
  total_kcal_day numeric,
  protein_g_day numeric,
  carbs_g_day numeric,
  fat_g_day numeric,
  sugar_g_day numeric,

  -- Meal presence/count + meal-type flags
  meal_count_day int not null default 0 check (meal_count_day >= 0),
  breakfast_logged boolean not null default false,
  lunch_logged boolean not null default false,
  dinner_logged boolean not null default false,

  -- Timing features (minutes from local midnight)
  time_first_meal_minutes int,
  time_last_meal_minutes int,
  eating_window_minutes int,

  -- Confidence (0..1), derived from meal_processing_runs.confidence_score
  nutrition_confidence_day numeric not null default 0.0
    check (nutrition_confidence_day >= 0 and nutrition_confidence_day <= 1),

  -- Missingness definition per your plan
  meals_missing_day boolean not null default true,

  created_at timestamptz not null default now(),
  primary key (user_id, date),

  constraint daily_nutrition2_time_first_bounds
    check (time_first_meal_minutes is null or (time_first_meal_minutes between 0 and 1439)),
  constraint daily_nutrition2_time_last_bounds
    check (time_last_meal_minutes is null or (time_last_meal_minutes between 0 and 1439)),
  constraint daily_nutrition2_time_window_bounds
    check (eating_window_minutes is null or (eating_window_minutes between 0 and 1440))
);

create index if not exists idx_daily_nutrition2_date
  on public.daily_nutrition2 (date);

create table if not exists daily_input_bundle_v12 (
user_id uuid not null references auth.users(id) on delete cascade,
date date not null,

bundle_version text not null default 'v1',
timezone text,
generated_at timestamptz not null default now(),

-- Convenience columns (fast queries)
overall_true_today int not null check (overall_true_today between 0 and 100),
physio_proxy_score_0_100 int check (physio_proxy_score_0_100 between 0 and 100),
gap_today int,

-- Group-level missingness + confidence (for cheap filtering)
missingness_json jsonb not null default '{}'::jsonb,
confidence_json jsonb not null default '{}'::jsonb,

-- Full authoritative bundle object
bundle_json jsonb not null,

created_at timestamptz not null default now(),
primary key (user_id, date)
);

create index if not exists idx_daily_input_bundle_v12_date
on daily_input_bundle_v12 (date);

create index if not exists idx_daily_input_bundle_v12_bundle_gin
on daily_input_bundle_v12 using gin (bundle_json);

create table if not exists user_state_current2 (
user_id uuid primary key references auth.users(id) on delete cascade,
state_version text not null default 'v1',
as_of_date date not null,
updated_at timestamptz not null default now(),

-- Store full state objects as JSONB for flexibility + auditability
state_json jsonb not null
);

create index if not exists idx_user_state_current2_asof
on user_state_current2 (as_of_date);

create table if not exists user_state_history2 (
user_id uuid not null references auth.users(id) on delete cascade,
date date not null,

state_version text not null default 'v1',
created_at timestamptz not null default now(),

-- FK to input bundle for that day
constraint fk_state_history2_to_bundle
foreign key (user_id, date)
references daily_input_bundle_v12(user_id, date)
on delete cascade,

-- Convenience day signals for querying
overall_true_today int not null check (overall_true_today between 0 and 100),
physio_proxy_score_0_100 int check (physio_proxy_score_0_100 between 0 and 100),
gap_today int,

-- Stored artifacts for audit/replay
deviations_json jsonb not null default '{}'::jsonb,
state_snapshot_json jsonb not null,
actions_generated_json jsonb not null default '{}'::jsonb,
outcomes_json jsonb,

primary key (user_id, date)
);

create index if not exists idx_user_state_history2_date
on user_state_history2 (date);
