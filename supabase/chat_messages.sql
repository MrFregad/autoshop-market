-- Онлайн-чат: таблиця повідомлень (сайт ↔ Telegram)
-- Виконати один раз у Supabase Dashboard → SQL Editor → Run

create table if not exists public.chat_messages (
  id bigint generated always as identity primary key,
  session_id uuid not null,
  sender text not null check (sender in ('client', 'admin')),
  text text not null,
  client_name text,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_session_idx
  on public.chat_messages (session_id, created_at);

alter table public.chat_messages enable row level security;

-- Віджет на сайті читає історію своєї сесії та отримує Realtime-події
create policy "chat_select" on public.chat_messages
  for select to anon using (true);

-- Вставка повідомлень іде через serverless-функції (/api/chat-send і webhook)
create policy "chat_insert" on public.chat_messages
  for insert to anon with check (true);

-- Вмикаємо Realtime для таблиці
alter publication supabase_realtime add table public.chat_messages;
