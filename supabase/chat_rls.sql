-- ═══════════════════════════════════════════════════════════
-- Закриваємо листування клієнтів від сторонніх очей
-- ═══════════════════════════════════════════════════════════
--
-- ПРОБЛЕМА (перевірено на живій базі публічним anon-ключем із JS-бандла):
--   GET /rest/v1/chat_messages?select=*        → 200, ВСІ повідомлення всіх клієнтів
--   GET /rest/v1/chat_sessions?select=*        → 200, всі сесії
--   GET /rest/v1/chat_config?select=*          → 200, id Telegram-групи власника
-- Політики були `to anon using (true)`, а chat_sessions і chat_config ще й
-- `for all` — тобто сторонній міг не лише читати, а й переписати id групи
-- і перенаправити чат магазину до себе.
--
-- ЩО РОБИМО: анонімному ключу доступу до цих трьох таблиць не лишається
-- зовсім. Працюють з ними тільки serverless-функції з service-ключем
-- (він обходить RLS): /api/chat-send, /api/chat-history, /api/telegram-webhook.
--
-- ⚠️ ПОРЯДОК ВАЖЛИВИЙ:
--   1) Спочатку додайте на Vercel env-змінну SUPABASE_SERVICE_KEY
--      (Supabase → Settings → API → service_role key) і зробіть redeploy.
--   2) Тільки потім виконайте цей файл: Supabase → SQL Editor → Run.
-- Якщо зробити навпаки — функції залишаться на anon-ключі і чат замовкне.

-- ── chat_messages: анонімному ключу ні читати, ні писати ──
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'chat_messages'
  loop
    execute format('drop policy %I on public.chat_messages', p.policyname);
  end loop;
end $$;

alter table public.chat_messages enable row level security;
-- Політик немає навмисно: RLS без політик = доступ заборонено всім,
-- крім service-ключа. Історію віддає /api/chat-history по session_id.

-- ── chat_sessions: те саме ──
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'chat_sessions'
  loop
    execute format('drop policy %I on public.chat_sessions', p.policyname);
  end loop;
end $$;

alter table public.chat_sessions enable row level security;

-- ── chat_config: id Telegram-групи, найчутливіше ──
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'chat_config'
  loop
    execute format('drop policy %I on public.chat_config', p.policyname);
  end loop;
end $$;

alter table public.chat_config enable row level security;

-- ── Realtime більше не потрібен ──
-- Віджет опитує /api/chat-history. Підписка все одно перестала б працювати:
-- Realtime доставляє рядки за політиками anon, а їх тепер немає.
-- (Якщо таблиці в публікації немає — рядок нічого не зламає.)
do $$
begin
  alter publication supabase_realtime drop table public.chat_messages;
exception when others then null;
end $$;

-- ═══ Перевірка: після Run ці три запити мають віддати 0 рядків ═══
-- (виконати у SQL Editor від імені anon — вкладка «Run as: anon»,
--  або просто відкрити сайт і переконатись, що чат працює)
--
--   select count(*) from public.chat_messages;
--   select count(*) from public.chat_sessions;
--   select count(*) from public.chat_config;
--
-- Таблиці products / car_models / reviews лишаються публічними на читання —
-- це вітрина магазину, так і має бути (supabase/secure_tables.sql).
-- Таблиця orders уже закрита: RLS увімкнено, політик немає
-- (supabase/dropt_migration.sql) — телефони й адреси покупців анонімним
-- ключем не читаються. Перевірено: запит повертає порожній список.
