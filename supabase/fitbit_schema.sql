-- OAuth state table
create table if not exists public.fitbit_oauth_state (
  state text primary key,
  app_user_id uuid references public.profiles(user_id) on delete cascade,
  code_verifier text not null,
  created_at timestamptz default now()
);

alter table public.fitbit_oauth_state enable row level security;

-- Allow authenticated users to INSERT rows for themselves
create policy "Users can insert their own fitbit_oauth_state"
  on public.fitbit_oauth_state
  for insert
  with check (auth.uid() = app_user_id);

-- Allow authenticated users to SELECT their own rows
create policy "Users can select their own fitbit_oauth_state"
  on public.fitbit_oauth_state
  for select
  using (auth.uid() = app_user_id);

-- Allow authenticated users to DELETE their own rows
create policy "Users can delete their own fitbit_oauth_state"
  on public.fitbit_oauth_state
  for delete
  using (auth.uid() = app_user_id);
  
-- Credentials table
create table if not exists public.fitbit_credentials (
  app_user_id uuid primary key references public.profiles(user_id) on delete cascade,
  fitbit_user_id text not null,
  access_token text not null,
  refresh_token text not null,
  scopes text[] default array[]::text[],
  updated_at timestamptz default now()
);

alter table public.fitbit_credentials enable row level security;

-- Allow authenticated users to INSERT rows for themselves
create policy "Users can insert their own fitbit_credentials"
  on public.fitbit_credentials
  for insert
  with check (auth.uid() = app_user_id);

-- Allow authenticated users to SELECT their own credentials
create policy "Users can select their own fitbit_credentials"
  on public.fitbit_credentials
  for select
  using (auth.uid() = app_user_id);

-- Allow authenticated users (via your server) to UPDATE their own credentials
create policy "Users can update their own fitbit_credentials"
  on public.fitbit_credentials
  for update
  using (auth.uid() = app_user_id)
  with check (auth.uid() = app_user_id);

create table if not exists public.fitbit_profile (
  app_user_id uuid primary key references public.profiles(user_id) on delete cascade,
  age integer,
  date_of_birth date,
  distance_unit text,
  gender text,
  height numeric,
  height_unit text,
  temperature_unit text,
  weight numeric,
  weight_unit text,
  user_timezone text,               
  updated_at timestamptz default now()
);

alter table public.fitbit_profile enable row level security;

-- Allow authenticated users to SELECT their own profile
create policy "Users can select their own fitbit_profile"
  on public.fitbit_profile
  for select
  using (auth.uid() = app_user_id);

-- Allow authenticated users (via your server) to INSERT their own profile
create policy "Users can insert their own fitbit_profile"
  on public.fitbit_profile
  for insert
  with check (auth.uid() = app_user_id);

-- Allow authenticated users to UPDATE their own profile (for future refreshes)
create policy "Users can update their own fitbit_profile"
  on public.fitbit_profile
  for update
  using (auth.uid() = app_user_id)
  with check (auth.uid() = app_user_id);

-- Biometric signals
create table if not exists public.fitbit_spo2_daily (
  app_user_id uuid references public.profiles(user_id) on delete cascade,
  date date not null,
  spo2_avg numeric,
  spo2_min numeric,
  spo2_max numeric,
  created_at timestamptz default now(),
  primary key (app_user_id, date)
);

create table if not exists public.fitbit_sleep_daily (
  app_user_id uuid references public.profiles(user_id) on delete cascade,
  date date not null,
  sleep_duration_ms bigint,
  sleep_start_time timestamptz,
  sleep_end_time timestamptz,
  minutes_asleep integer,
  minutes_awake integer,
  time_in_bed integer,
  deep_minutes integer,
  light_minutes integer,
  rem_minutes integer,
  wake_minutes integer,
  sleep_score integer,
  created_at timestamptz default now(),
  primary key (app_user_id, date)
);

create table if not exists public.fitbit_overnight_daily (
  app_user_id uuid references public.profiles(user_id) on delete cascade,
  date date not null,
  oxygen_variation numeric,    
  blood_oxygen_avg numeric,
  breathing_rate numeric,
  skin_temp_relative numeric,
  created_at timestamptz default now(),
  primary key (app_user_id, date)
);

create table if not exists public.fitbit_hrv_daily (
  app_user_id uuid references public.profiles(user_id) on delete cascade,
  date date not null,
  hrv_daily_rmssd numeric,
  hrv_deep_rmssd numeric,
  created_at timestamptz default now(),
  primary key (app_user_id, date)
);

create table if not exists public.fitbit_activity_daily (
  app_user_id uuid references public.profiles(user_id) on delete cascade,
  date date not null,
  steps integer,
  energy_burned_calories_out numeric,
  activity_calories numeric,
  bmr_calories numeric,
  distance_total_km numeric,
  lightly_active_minutes integer,
  fairly_active_minutes integer,
  very_active_minutes integer,
  sedentary_minutes integer,
  resting_heart_rate integer,
  created_at timestamptz default now(),
  primary key (app_user_id, date)
);
