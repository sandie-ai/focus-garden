function parseProjectRefFromUrl(supabaseUrl: string) {
  if (!supabaseUrl) return ''
  try {
    const hostname = new URL(supabaseUrl).hostname
    return hostname.split('.')[0] || ''
  } catch {
    return ''
  }
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const body = await readBody<{ supabaseUrl?: string }>(event).catch(() => ({}))
  const token = String(config.supabaseToken || '').trim()
  const explicitProjectRef = String(config.supabaseProjectRef || '').trim()
  const projectRefFromUrl = parseProjectRefFromUrl(
    String(body.supabaseUrl || config.public.supabaseUrl || ''),
  )
  const projectRef = explicitProjectRef || projectRefFromUrl

  if (!token || !projectRef) {
    return {
      ok: false,
      skipped: true,
      reason: 'missing_supabase_token_or_project_ref',
    }
  }

  const query = `
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

create table if not exists public.garden_history (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  session_type text not null check (session_type in ('focus', 'break')),
  duration_minutes integer not null check (duration_minutes > 0),
  completed_at timestamptz not null default timezone('utc', now())
);

create index if not exists garden_history_user_completed_idx on public.garden_history (user_id, completed_at desc);

create table if not exists public.garden_todos (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  todo_text text not null,
  completed boolean not null default false,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists garden_todos_user_created_idx on public.garden_todos (user_id, created_at asc);
`

  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  })

  if (!response.ok) {
    return {
      ok: false,
      skipped: true,
      reason: 'management_api_failed',
      status: response.status,
    }
  }

  return { ok: true }
})
