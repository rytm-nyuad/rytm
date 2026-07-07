create table public.user_goals1 (
  goal_id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  status public.goal_status_v1 not null default 'active'::goal_status_v1,
  goal_type public.goal_type_v1 not null,
  title text not null,
  priority integer not null default 1,
  goal_spec_json jsonb not null default '{}'::jsonb,
  defaults_json jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint user_goals1_pkey primary key (goal_id),
  constraint user_goals1_user_id_fkey foreign KEY (user_id) references profiles (user_id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_user_goals1_user_id on public.user_goals1 using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_user_goals1_user_status on public.user_goals1 using btree (user_id, status) TABLESPACE pg_default;

create index IF not exists idx_user_goals1_user_priority on public.user_goals1 using btree (user_id, priority) TABLESPACE pg_default;

create trigger trg_user_goals1_set_updated_at BEFORE
update on user_goals1 for EACH row
execute FUNCTION set_updated_at ();

create table public.daily_plans1 (
  plan_id uuid not null default gen_random_uuid (),
  ingestion_run_id uuid not null,
  user_id uuid not null,
  for_date date not null,
  status public.plan_status_v1 not null default 'draft'::plan_status_v1,
  day_constraints_json jsonb not null default '{}'::jsonb,
  selected_domains_json jsonb not null default '[]'::jsonb,
  plan_json jsonb not null default '{}'::jsonb,
  morning_message text null,
  budget_policy_json jsonb not null default '{}'::jsonb,
  budget_applied_json jsonb not null default '{}'::jsonb,
  notes text null,
  error_json jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint daily_plans1_pkey primary key (plan_id),
  constraint uq_daily_plans1_ingestion unique (ingestion_run_id),
  constraint uq_daily_plans1_user_date unique (user_id, for_date),
  constraint daily_plans1_ingestion_run_id_fkey foreign KEY (ingestion_run_id) references ingestion_runs1 (ingestion_run_id) on delete CASCADE,
  constraint daily_plans1_user_id_fkey foreign KEY (user_id) references profiles (user_id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_daily_plans1_user_date on public.daily_plans1 using btree (user_id, for_date) TABLESPACE pg_default;

create trigger trg_daily_plans1_set_updated_at BEFORE
update on daily_plans1 for EACH row
execute FUNCTION set_updated_at ();

create table public.goal_interviews1 (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  for_date date not null,
  summary_json jsonb not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint goal_interviews1_pkey primary key (id),
  constraint goal_interviews1_user_id_fkey foreign KEY (user_id) references profiles (user_id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists goal_interviews1_user_date_idx on public.goal_interviews1 using btree (user_id, for_date desc) TABLESPACE pg_default;

create trigger set_updated_at_goal_interviews1 BEFORE
update on goal_interviews1 for EACH row
execute FUNCTION set_updated_at ();

create table public.plan_actions1 (
  plan_action_id uuid not null default gen_random_uuid (),
  plan_id uuid not null,
  ingestion_run_id uuid not null,
  user_id uuid not null,
  for_date date not null,
  action_id text not null,
  action_source public.action_source_v1 not null default 'generated'::action_source_v1,
  domain text null,
  priority smallint null,
  effort_level public.effort_level_v1 null,
  tags text[] not null default array[]::text[],
  reason text null,
  assumptions_json jsonb not null default '{}'::jsonb,
  feasibility_constraints_json jsonb not null default '{}'::jsonb,
  evaluation_mode public.evaluation_mode_v1 not null default 'mixed'::evaluation_mode_v1,
  success_criteria_json jsonb not null default '{}'::jsonb,
  required_feature_keys feature_key_v1[] not null default array[]::feature_key_v1[],
  requires_user_rating boolean not null default false,
  fallbacks_json jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint plan_actions1_pkey primary key (plan_action_id),
  constraint uq_plan_actions1_unique_action_per_plan unique (plan_id, action_id),
  constraint plan_actions1_ingestion_run_id_fkey foreign KEY (ingestion_run_id) references ingestion_runs1 (ingestion_run_id) on delete CASCADE,
  constraint plan_actions1_plan_id_fkey foreign KEY (plan_id) references daily_plans1 (plan_id) on delete CASCADE,
  constraint plan_actions1_user_id_fkey foreign KEY (user_id) references profiles (user_id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_plan_actions1_user_date on public.plan_actions1 using btree (user_id, for_date) TABLESPACE pg_default;

create index IF not exists idx_plan_actions1_plan on public.plan_actions1 using btree (plan_id) TABLESPACE pg_default;

create index IF not exists idx_plan_actions1_ingestion on public.plan_actions1 using btree (ingestion_run_id) TABLESPACE pg_default;

create trigger trg_plan_actions1_set_updated_at BEFORE
update on plan_actions1 for EACH row
execute FUNCTION set_updated_at ();

create table public.daily_features1 (
  user_id uuid not null,
  feature_date date not null,
  feature_key public.feature_key_v1 not null,
  value_num double precision null,
  value_text text null,
  unit text null,
  confidence double precision null,
  source_lineage_json jsonb not null default '{}'::jsonb,
  ingestion_run_id uuid null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  feature_layer public.feature_layer_v1 not null default 'derived'::feature_layer_v1,
  value_json jsonb null,
  constraint daily_features1_pkey primary key (user_id, feature_date, feature_key),
  constraint daily_features1_ingestion_run_id_fkey foreign KEY (ingestion_run_id) references ingestion_runs1 (ingestion_run_id) on delete set null,
  constraint daily_features1_user_id_fkey foreign KEY (user_id) references profiles (user_id) on delete CASCADE,
  constraint chk_daily_features1_no_raw_layer check ((feature_layer <> 'raw'::feature_layer_v1))
) TABLESPACE pg_default;

create index IF not exists idx_daily_features1_user_date on public.daily_features1 using btree (user_id, feature_date) TABLESPACE pg_default;

create index IF not exists idx_daily_features1_run on public.daily_features1 using btree (ingestion_run_id) TABLESPACE pg_default;

create trigger trg_daily_features1_set_updated_at BEFORE
update on daily_features1 for EACH row
execute FUNCTION set_updated_at ();