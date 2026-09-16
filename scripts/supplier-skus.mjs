// Чтение артикулов поставщика из products постранично.
//
// Почему не .range(from, from + 999): PostgREST превращает это в OFFSET,
// а Postgres на каждой странице заново пролистывает все пропущенные строки.
// На 70+ тыс. товаров запрос перестаёт укладываться в statement timeout
// Supabase и импорт падает (см. падения DD Audio). Здесь keyset-пагинация:
// «дай 1000 артикулов больше предыдущего» — работает по уникальному индексу
// (supplier, supplier_sku) и одинаково быстро на любой странице.

const PAGE = 1000;

export async function fetchSupplierSkus(supabase, supplier, { manualOnly = false } = {}) {
  const skus = [];
  let last = '';
  for (;;) {
    // Товаров с ручной ценой единицы на всю базу. Фильтр по supplier к ним
    // не добавляем: без индекса он заставляет Postgres лезть в таблицу за
    // каждой строкой и запрос не укладывается в timeout. Проще отобрать
    // своего поставщика уже в памяти.
    const q = manualOnly
      ? supabase.from('products').select('supplier,supplier_sku').eq('price_manual', true)
      : supabase.from('products').select('supplier_sku').eq('supplier', supplier);

    const { data, error } = await q
      .gt('supplier_sku', last)
      .order('supplier_sku', { ascending: true })
      .limit(PAGE);
    if (error) return { skus, error };

    for (const r of data) {
      if (!manualOnly || r.supplier === supplier) skus.push(r.supplier_sku);
    }
    if (data.length < PAGE) return { skus, error: null };
    last = data[data.length - 1].supplier_sku;
  }
}
