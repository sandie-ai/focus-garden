create extension if not exists pgcrypto;

create table if not exists public.garden_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  total_sessions integer not null default 0,
  sessions_today integer not null default 0,
  streak_days integer not null default 0,
  last_session_date date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists garden_sessions_user_id_key on public.garden_sessions (user_id);
create index if not exists garden_sessions_updated_at_idx on public.garden_sessions (updated_at desc);
