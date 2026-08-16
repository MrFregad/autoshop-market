-- Журнал пошукових запитів — джерело для /admin/stats.
--
-- Навіщо окрема таблиця, якщо є Vercel Analytics: у Vercel НЕМАЄ API, яким
-- можна прочитати свої ж події назад. Їх видно тільки в його дашборді, і
-- зібрати з них сторінку «топ-50 запитів» неможливо. Тому події воронки
-- йдуть у Vercel (там зручні графіки), а пошукові запити дублюються сюди —
-- це єдиний спосіб побачити, ЧОГО люди не знайшли.
--
-- Виконати ОДИН РАЗ у Supabase → SQL Editor.

create table if not exists search_log (
  id          bigserial primary key,
  query       text not null,
  results     integer not null default 0,   -- скільки знайшлось; 0 = порожня видача
  created_at  timestamptz not null default now()
);

-- Звіт завжди дивиться «за останні 30 днів» і групує за запитом
create index if not exists search_log_created_idx on search_log (created_at desc);

alter table search_log enable row level security;

-- Сайт (анонімний ключ) може ТІЛЬКИ дописувати рядок. Читати журнал
-- анонімно не можна: конкуренти не побачать, за чим до вас приходять.
-- Звіт /admin/stats читає його service-ключем на сервері.
drop policy if exists search_log_insert_anon on search_log;
create policy search_log_insert_anon on search_log
  for insert to anon with check (true);

-- Перевірка: має бути 0 рядків і жодної помилки
select count(*) as записів from search_log;
