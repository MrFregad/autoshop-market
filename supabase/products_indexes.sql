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

analyze products;
