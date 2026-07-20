-- User check-off for coach plan actions (manual completion on /coach).
-- Apply manually in Supabase SQL editor if not yet present.

alter table public.plan_actions1
  add column if not exists user_completed_at timestamp with time zone null;

create index if not exists idx_plan_actions1_user_completed
  on public.plan_actions1 using btree (user_id, for_date)
  where user_completed_at is not null;

comment on column public.plan_actions1.user_completed_at is
  'When the user marked this plan action complete in the coach UI; null if incomplete.';
