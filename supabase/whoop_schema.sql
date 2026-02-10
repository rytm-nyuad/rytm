-- WHOOP OAuth state table (for CSRF protection)
create table if not exists public.whoop_oauth_state (
  state text primary key,
  app_user_id uuid references public.profiles(user_id) on delete cascade,
  created_at timestamptz default now()
);

alter table public.whoop_oauth_state enable row level security;

-- Allow authenticated users to INSERT rows for themselves
create policy "Users can insert their own whoop_oauth_state"
  on public.whoop_oauth_state
  for insert
  with check (auth.uid() = app_user_id);

-- Allow authenticated users to SELECT their own rows
create policy "Users can select their own whoop_oauth_state"
  on public.whoop_oauth_state
  for select
  using (auth.uid() = app_user_id);

-- Allow authenticated users to DELETE their own rows
create policy "Users can delete their own whoop_oauth_state"
  on public.whoop_oauth_state
  for delete
  using (auth.uid() = app_user_id);

-- WHOOP Credentials table
-- Tokens are protected via RLS - only backend/service role can read/write
create table if not exists public.whoop_credentials (
  app_user_id uuid primary key references public.profiles(user_id) on delete cascade,
  whoop_user_id bigint not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  scope text not null,
  status text not null default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  revoked_at timestamptz,
  last_refresh_at timestamptz,
  last_refresh_error text,
  refresh_in_progress_until timestamptz
);

alter table public.whoop_credentials enable row level security;

-- RLS: Users can only SELECT their own credentials (not the tokens themselves)
-- This allows checking if they're connected, but doesn't expose sensitive tokens
create policy "Users can check their whoop connection status"
  on public.whoop_credentials
  for select
  using (auth.uid() = app_user_id);

-- RLS: Only service role can insert credentials
-- Backend uses service role to store tokens securely
create policy "Service role can insert whoop_credentials"
  on public.whoop_credentials
  for insert
  with check (auth.uid() = app_user_id);

-- RLS: Only service role can update credentials
create policy "Service role can update whoop_credentials"
  on public.whoop_credentials
  for update
  using (auth.uid() = app_user_id)
  with check (auth.uid() = app_user_id);

-- RLS: Users can delete their own credentials (for disconnect)
create policy "Users can delete their own whoop_credentials"
  on public.whoop_credentials
  for delete
  using (auth.uid() = app_user_id);

-- Add comments for documentation
comment on column public.whoop_credentials.status is 'Connection status: active (valid tokens) or needs_reauth (user must reconnect)';
comment on column public.whoop_credentials.revoked_at is 'Timestamp when the user disconnected or tokens were revoked';
comment on column public.whoop_credentials.last_refresh_at is 'Timestamp of last successful token refresh';
comment on column public.whoop_credentials.last_refresh_error is 'Last refresh error message for debugging';
comment on column public.whoop_credentials.refresh_in_progress_until is 'Lock TTL - if set to future timestamp, refresh is in progress';

-- Create indexes for efficient filtering
create index if not exists idx_whoop_credentials_status on public.whoop_credentials(status);
create index if not exists idx_whoop_credentials_expires_at on public.whoop_credentials(expires_at);
