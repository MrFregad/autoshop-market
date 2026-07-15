-- ─────────────────────────────────────────────────────────────
-- Миграция для интеграции с поставщиком DD Audio (ddaudio.com.ua).
-- Выполнить ОДИН РАЗ в Supabase: SQL Editor → New query → вставить → Run.
-- Повторный запуск безопасен (все команды с IF NOT EXISTS).
-- ─────────────────────────────────────────────────────────────

-- 1) Новые поля в products (заполняет scripts/ddaudio-import.mjs):
--    marks       — марки авто, к которым подходит товар (["Citroen","Peugeot"]);
--                  массив, потому что один товар подходит нескольким авто
--    models      — модели с годами (["Citroen C-2 2003-2009", ...])
--    parent_id   — id родительского товара у поставщика (группировка вариантов)
--    short_title — короткое название варианта ("4 шт, Carmos")
alter table public.products add column if not exists marks text[];
alter table public.products add column if not exists models text[];
alter table public.products add column if not exists parent_id text;
alter table public.products add column if not exists short_title text;

-- GIN-индексы: быстрый поиск «в массиве есть значение» для фильтра
-- «Підбір за авто» (запросы вида marks @> '{Citroen}')
create index if not exists products_marks_idx on public.products using gin (marks);
create index if not exists products_models_idx on public.products using gin (models);
create index if not exists products_supplier_idx on public.products (supplier);

-- 2) Справочник «марка → модель» для выпадающих списков подбора по авто.
--    Пересобирается импорт-скриптом; фронт читает его целиком (он маленький),
--    чтобы не делать distinct-запросы по 70+ тысячам товаров.
create table if not exists public.car_models (
  mark text not null,
  model text not null,
  primary key (mark, model)
);

-- Какие категории/подкатегории есть у этой модели и сколько товаров в наличии:
-- {"Дефлектори": {"Козирки": 2, "Дефлектор на капот": 5}, ...}
-- Заполняет импорт-скрипт; сайт подсвечивает в подборе пустые категории.
alter table public.car_models add column if not exists categories jsonb;

-- Читать справочник можно всем (это просто список марок/моделей),
-- писать — только service-ключом (импорт-скрипт).
alter table public.car_models enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'car_models'
      and policyname = 'car_models_read'
  ) then
    create policy "car_models_read" on public.car_models
      for select using (true);
  end if;
end $$;
