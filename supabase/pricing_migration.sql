-- Ціноутворення: закупівельна ціна в базі + захист ручних цін.
-- Виконати один раз у Supabase → SQL Editor.
--
-- УВАГА: у ТЗ був крок «update products set cost_price = price» —
-- його тут свідомо немає. Поточний products.price — це НЕ закупівля:
-- у DD Audio це РРЦ постачальника, у Dropt — дроп-ціна вже з націнкою 50%.
-- Якщо скопіювати price у cost_price, формула порахує націнку від роздрібу
-- і ціни злетять у 1.5-1.8 раза. Закупівлю заповнюють нічні імпорти:
-- DD Audio — з оптового прайсу (EUR/USD × курс НБУ), Dropt — з фіда.

alter table products add column if not exists cost_price numeric;
alter table products add column if not exists price_manual boolean not null default false;
alter table products add column if not exists price_updated_at timestamptz;

comment on column products.cost_price is 'Закупівля в грн на момент останнього імпорту (для валютних постачальників — за курсом НБУ того дня)';
comment on column products.price_manual is 'true = ціну виставили руками під ринок; масовий перерахунок та імпорт її не чіпають';

-- Звіт «продаємо в мінус» і сортування за прибутком — без full scan
create index if not exists products_cost_price_idx on products (cost_price)
  where cost_price is not null;

-- Нічний імпорт щоразу питає «які товари цього постачальника з ручною ціною».
-- Без цього індексу запит перебирає всі 100 тис. рядків і впирається
-- у statement timeout Supabase — імпорт затирає ручні ціни або падає.
create index if not exists products_price_manual_idx
  on products (supplier, supplier_sku)
  where price_manual;
