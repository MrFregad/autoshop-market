-- Індекси під пошук і каталог.
--
-- Проблема, заміряна на живій базі (72 620 товарів):
--   пошук «бризковики» — точний підрахунок падав по statement timeout за 3,5 с;
--   категорія «Килимки» — точний підрахунок 1,2 с.
-- Самі товари приходили за 400 мс: гальмував не вибір рядків, а підрахунок,
-- бо ilike '%текст%' без trigram-індексу читає таблицю цілком.
--
-- Виконати ОДИН РАЗ у Supabase → SQL Editor. Побудова займе 1-3 хвилини;
-- SQL Editor може показати «Failed to fetch» — це браузер не дочекався
-- відповіді, індекси при цьому будуються далі. Перевірка — запит унизу файлу.

-- 1. Розширення для пошуку підрядком. Без нього GIN-індекси нижче не створяться.
create extension if not exists pg_trgm;

-- 2. Пошук: ilike '%…%' по кожному полю, яке читає buildSearchFilters()
--    (src/lib/searchTranslate.ts → SEARCH_FIELDS). Важливо, щоб індекси були
--    на ВСІХ полях запиту: OR по одному неіндексованому полю змушує базу
--    читати таблицю повністю, і решта індексів стає марною. Саме тому
--    description із пошуку прибрано — trigram-індекс на довгих описах
--    важить більше за саму таблицю, а давав він 0,05% результатів.
create index if not exists products_name_trgm_idx
  on products using gin (name gin_trgm_ops);

create index if not exists products_category_trgm_idx
  on products using gin (category gin_trgm_ops);

create index if not exists products_subcategory_trgm_idx
  on products using gin (subcategory gin_trgm_ops);

create index if not exists products_brand_trgm_idx
  on products using gin (brand gin_trgm_ops);

create index if not exists products_compatibility_trgm_idx
  on products using gin (compatibility gin_trgm_ops);

-- 3. Каталог за категорією. Точний збіг (=), тому btree, а не trigram.
--    Пара (category, id desc) закриває і фільтр, і сортування каталогу.
create index if not exists products_category_id_idx
  on products (category, id desc);

create index if not exists products_category_subcategory_id_idx
  on products (category, subcategory, id desc);

-- 4. Ціна. Вітрина на головній бере «доступні товари дешевші за 4000»,
--    і без індексу цей запит сканував усі 72 620 рядків.
create index if not exists products_price_idx
  on products (price)
  where available is not false;

-- 5. Оновлюємо статистику, щоб планувальник одразу побачив нові індекси.
analyze products;

-- Перевірка: має бути 8 рядків з нашими індексами.
select indexname, pg_size_pretty(pg_relation_size(indexname::regclass)) as розмір
from pg_indexes
where tablename = 'products' and indexname like 'products_%'
order by indexname;
