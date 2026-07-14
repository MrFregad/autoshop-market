-- ─────────────────────────────────────────────────────────────
-- Миграция для интеграции с поставщиком Dropt (dropt.in.ua).
-- Выполнить ОДИН РАЗ в Supabase: SQL Editor → New query → вставить → Run.
-- Повторный запуск безопасен (все команды с IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────

-- 1) Новые поля в products:
--    supplier      — код поставщика ('dropt'); у своих товаров NULL
--    supplier_sku  — артикул товара у поставщика (vendorCode из фида)
--    supplier_url  — ссылка на товар на сайте поставщика (для быстрого заказа)
--    available     — есть ли товар в наличии у поставщика
alter table public.products add column if not exists supplier text;
alter table public.products add column if not exists supplier_sku text;
alter table public.products add column if not exists supplier_url text;
alter table public.products add column if not exists available boolean not null default true;

-- Уникальность артикула в рамках одного поставщика —
-- на этом построен upsert (повторный импорт обновляет товар, а не дублирует)
create unique index if not exists products_supplier_sku_uniq
  on public.products (supplier, supplier_sku);

-- 2) Таблица заказов. Раньше заказы жили только в Telegram,
--    теперь каждый заказ сохраняется и здесь.
create table if not exists public.orders (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text not null,              -- ФИО покупателя
  phone text not null,             -- телефон
  city text,                       -- город доставки
  np_office text,                  -- отделение Новой Почты / Укрпошты
  address_full text,               -- адрес одной строкой (для старых заказов)
  items jsonb not null,            -- товары: [{id, name, quantity, price, supplier, supplier_sku}]
  total numeric not null default 0,
  -- Статус передачи заказа поставщику Dropt:
  dropt_order_id text,             -- id заказа в системе Dropt (после успешной отправки)
  dropt_status text,               -- null | 'sent' | 'error' | 'skipped'
  dropt_synced_at timestamptz      -- когда отправили в Dropt
);

-- Включаем защиту строк. Политик НЕТ намеренно:
-- анонимный ключ сайта не может ни читать, ни писать заказы.
-- Сервер (Vercel functions) пишет через service-ключ, он обходит RLS.
alter table public.orders enable row level security;
