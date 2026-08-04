-- Індекси для каталогу товарів.
--
-- Проблема: у таблиці products десятки тисяч рядків, а індексу по category не
-- було. Запит каталогу (category = X ORDER BY id DESC LIMIT 12 + точний count)
-- робив повний скан таблиці. На «холодній» базі це >3 с → Supabase обривав
-- запит (statement timeout, код 57014), і сайт показував «товарів не знайдено»
-- на категоріях, де товари є (напр. «Мийка авто»).
--
-- Виконати один раз у Supabase → SQL Editor. Займе кілька секунд.

create index if not exists products_category_id_idx
  on products (category, id desc);

create index if not exists products_category_subcategory_id_idx
  on products (category, subcategory, id desc);

-- Вітрина на головній: «Акції» (old_price is not null) і «Новинки».
-- Обидва запити — це «останні N доступних товарів дешевше 4000», тобто
-- ORDER BY id DESC з фільтром. Без індексу база сканувала всю таблицю
-- (~65 000 рядків) і на «холодному» старті обривала запит по таймауту:
-- блок «Акції» віддавав 500, а сусідній запит без old_price — 200.
-- Часткові індекси (where …) маленькі: у них лише ті рядки, що потрібні.
create index if not exists products_sale_idx
  on products (id desc)
  where old_price is not null and available is not false;

create index if not exists products_fresh_idx
  on products (id desc)
  where available is not false;

analyze products;
