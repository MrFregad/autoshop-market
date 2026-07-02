-- Кімнати чату: кожен клієнт = окрема тема (Topic) у Telegram-групі
-- Виконати один раз у Supabase Dashboard → SQL Editor → Run

-- Відповідність: сесія клієнта ↔ тема в Telegram-групі
create table if not exists public.chat_sessions (
  session_id uuid primary key,
  topic_id bigint not null,
  client_name text,
  created_at timestamptz not null default now()
);

-- Налаштування чату (id групи-кімнати тощо)
create table if not exists public.chat_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.chat_sessions enable row level security;
alter table public.chat_config enable row level security;

-- Serverless-функції працюють через anon-ключ — даємо їм доступ
create policy "sessions_all" on public.chat_sessions
  for all to anon using (true) with check (true);

create policy "config_all" on public.chat_config
  for all to anon using (true) with check (true);
