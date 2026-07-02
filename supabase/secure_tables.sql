-- Захист таблиць від стороннього запису
-- УВАГА: спочатку додайте env-змінну SUPABASE_SERVICE_KEY на Vercel
-- (інакше адмінка не зможе зберігати товари)!
-- Виконати один раз у Supabase Dashboard → SQL Editor → Run

-- ── products: відвідувачам лише читання ──
-- Прибираємо всі старі політики
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'products'
  loop
    execute format('drop policy %I on public.products', p.policyname);
  end loop;
end $$;

alter table public.products enable row level security;

create policy "products_read" on public.products
  for select using (true);
-- Запис (додати/змінити/видалити) — лише через /api/admin із service-ключем

-- ── reviews: читати й додавати можна, змінювати/видаляти — ні ──
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'reviews'
  loop
    execute format('drop policy %I on public.reviews', p.policyname);
  end loop;
end $$;

alter table public.reviews enable row level security;

create policy "reviews_read" on public.reviews
  for select using (true);

create policy "reviews_insert" on public.reviews
  for insert with check (true);
