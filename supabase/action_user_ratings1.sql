-- User ratings/comments for coach plan actions.
-- Apply manually in Supabase SQL editor if the table is missing.
-- Matches existing production shape: action_user_ratings1

-- Scale discriminator (how rating_value_num should be interpreted).
-- Live DB values: thumbs | likert_1_5 | likert_0_10
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'rating_scale_v1'
      and n.nspname = 'public'
  ) then
    create type public.rating_scale_v1 as enum (
      'thumbs',
      'likert_1_5',
      'likert_0_10'
    );
  end if;
end $$;

create table if not exists public.action_user_ratings1 (
  rating_id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  for_date date not null,
  plan_id uuid not null,
  plan_action_id uuid null,
  action_id text not null,
  rating_scale public.rating_scale_v1 not null default 'likert_1_5'::rating_scale_v1,
  rating_value_num double precision null,
  rating_value_text text null,
  comment text null,
  provided_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint action_user_ratings1_pkey primary key (rating_id),
  constraint action_user_ratings1_user_id_fkey
    foreign key (user_id) references public.profiles (user_id) on delete cascade,
  constraint action_user_ratings1_plan_id_fkey
    foreign key (plan_id) references public.daily_plans1 (plan_id) on delete cascade,
  constraint action_user_ratings1_plan_action_id_fkey
    foreign key (plan_action_id) references public.plan_actions1 (plan_action_id) on delete set null,
  constraint uq_action_user_ratings1_user_date_action
    unique (user_id, for_date, action_id),
  constraint chk_action_user_ratings1_likert_1_5_num check (
    rating_scale <> 'likert_1_5'::rating_scale_v1
    or rating_value_num is null
    or (rating_value_num >= 1 and rating_value_num <= 5)
  ),
  constraint chk_action_user_ratings1_likert_0_10_num check (
    rating_scale <> 'likert_0_10'::rating_scale_v1
    or rating_value_num is null
    or (rating_value_num >= 0 and rating_value_num <= 10)
  ),
  constraint chk_action_user_ratings1_thumbs_num check (
    rating_scale <> 'thumbs'::rating_scale_v1
    or rating_value_num is null
    or rating_value_num in (0, 1)
  ),
  constraint chk_action_user_ratings1_comment_len check (
    comment is null or char_length(comment) <= 2000
  ),
  constraint chk_action_user_ratings1_action_id_len check (
    char_length(action_id) >= 1 and char_length(action_id) <= 128
  )
);

create index if not exists idx_action_user_ratings1_user_date
  on public.action_user_ratings1 using btree (user_id, for_date);

create index if not exists idx_action_user_ratings1_plan
  on public.action_user_ratings1 using btree (plan_id);

create index if not exists idx_action_user_ratings1_action
  on public.action_user_ratings1 using btree (user_id, action_id);

-- updated_at trigger (reuses shared set_updated_at() if present)
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'set_updated_at' and n.nspname = 'public'
  ) and not exists (
    select 1 from pg_trigger
    where tgname = 'trg_action_user_ratings1_set_updated_at'
  ) then
    create trigger trg_action_user_ratings1_set_updated_at
      before update on public.action_user_ratings1
      for each row
      execute function set_updated_at();
  end if;
end $$;

alter table public.action_user_ratings1 enable row level security;

drop policy if exists "Users can select their own action_user_ratings1"
  on public.action_user_ratings1;
create policy "Users can select their own action_user_ratings1"
  on public.action_user_ratings1
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own action_user_ratings1"
  on public.action_user_ratings1;
create policy "Users can insert their own action_user_ratings1"
  on public.action_user_ratings1
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own action_user_ratings1"
  on public.action_user_ratings1;
create policy "Users can update their own action_user_ratings1"
  on public.action_user_ratings1
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own action_user_ratings1"
  on public.action_user_ratings1;
create policy "Users can delete their own action_user_ratings1"
  on public.action_user_ratings1
  for delete
  using (auth.uid() = user_id);

comment on table public.action_user_ratings1 is
  'Per-action user ratings and optional comments from the coach UI.';

comment on column public.action_user_ratings1.rating_scale is
  'How rating_value_num is interpreted: thumbs (0/1), likert_1_5 (1–5), likert_0_10 (0–10).';

comment on column public.action_user_ratings1.rating_value_num is
  'Numeric rating on the selected scale (coach UI uses likert_1_5).';

comment on column public.action_user_ratings1.comment is
  'Optional free-text feedback; max 2000 characters.';
