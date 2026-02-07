-- OAuth state table for Google Calendar
create table if not exists public.calendar_oauth_state (
  state text primary key,
  app_user_id uuid references public.profiles(user_id) on delete cascade,
  code_verifier text not null,
  created_at timestamptz default now()
);

alter table public.calendar_oauth_state enable row level security;

create policy "Users can insert their own calendar_oauth_state"
  on public.calendar_oauth_state
  for insert
  with check (auth.uid() = app_user_id);

create policy "Users can select their own calendar_oauth_state"
  on public.calendar_oauth_state
  for select
  using (auth.uid() = app_user_id);

create policy "Users can delete their own calendar_oauth_state"
  on public.calendar_oauth_state
  for delete
  using (auth.uid() = app_user_id);

-- Credentials table for Calendar tokens
create table if not exists public.calendar_credentials (
  app_user_id uuid primary key references public.profiles(user_id) on delete cascade,
  provider_user_id text,
  access_token text not null,
  refresh_token text,
  scopes text[] default array[]::text[],
  status text default 'active', -- 'active' | 'needs_reauth'
  updated_at timestamptz default now()
);

alter table public.calendar_credentials enable row level security;

create policy "Users can insert their own calendar_credentials"
  on public.calendar_credentials
  for insert
  with check (auth.uid() = app_user_id);

create policy "Users can select their own calendar_credentials"
  on public.calendar_credentials
  for select
  using (auth.uid() = app_user_id);

create policy "Users can update their own calendar_credentials"
  on public.calendar_credentials
  for update
  using (auth.uid() = app_user_id)
  with check (auth.uid() = app_user_id);

-- Profile / metadata about user's calendar
create table if not exists public.calendar_profile (
  app_user_id uuid primary key references public.profiles(user_id) on delete cascade,
  email text,
  display_name text,
  timezone text,
  updated_at timestamptz default now()
);

alter table public.calendar_profile enable row level security;

create policy "Users can select their own calendar_profile"
  on public.calendar_profile
  for select
  using (auth.uid() = app_user_id);

create policy "Users can insert their own calendar_profile"
  on public.calendar_profile
  for insert
  with check (auth.uid() = app_user_id);

create policy "Users can update their own calendar_profile"
  on public.calendar_profile
  for update
  using (auth.uid() = app_user_id)
  with check (auth.uid() = app_user_id);

-- Optional: table for storing calendar events (example schema)
create table if not exists public.calendar_events (
  app_user_id uuid references public.profiles(user_id) on delete cascade,
  event_id text not null,
  calendar_id text,
  start_time timestamptz,
  end_time timestamptz,
  title text,
  description text,
  location text,
  raw jsonb,
  created_at timestamptz default now(),
  primary key (app_user_id, event_id)
);

alter table public.calendar_events enable row level security;

create policy "Users can insert their own calendar_events"
  on public.calendar_events
  for insert
  with check (auth.uid() = app_user_id);

create policy "Users can select their own calendar_events"
  on public.calendar_events
  for select
  using (auth.uid() = app_user_id);

create policy "Users can delete their own calendar_events"
  on public.calendar_events
  for delete
  using (auth.uid() = app_user_id);
