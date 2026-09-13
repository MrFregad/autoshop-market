// Відбір товарів для карти сайту: node scripts/sitemap-products.mjs [кількість]
//
// Навіщо: у карті було 29 тис. адрес, у індексі — 4,5 тис. Молодому сайту
// Google дає бюджет на сотні сторінок, а гігантська карта при майже нульовій
// індексації — сигнал низької якості. Тому в карту йдуть лише найкращі
// картки: реальне фото, сумісність з авто, змістовний опис (> 200 символів).
//
// Чому окремим скриптом, а не запитом у /sitemap-2.xml: фільтр по довжині
// опису PostgREST не вміє, а LIKE по великих категоріях (Килимки) падає по
// таймауту бази. Скрипт обходить таблицю локально й пише список id у
// api/_lib/sitemapProducts.mjs. Наявність карта перевіряє при кожній збірці.
//
// Наступна хвиля (коли ці увійдуть в індекс): запустити з більшим числом,
// напр. node scripts/sitemap-products.mjs 2000, закомітити файл.

import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const SUPABASE_URL = 'https://vhvedefyixgluayqahhh.supabase.co';
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZodmVkZWZ5aXhnbHVheXFhaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzE0OTEsImV4cCI6MjA5NjY0NzQ5MX0.RMK8MjUTTOO4slWV5kQw5ue7oAkUQyBFhaXhqz3FGtM';
const LIMIT = Number(process.argv[2]) || 800;
const BATCH = 1000;
const OUT = new URL('../api/_lib/sitemapProducts.mjs', import.meta.url);

const plainLength = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().length;
const hasPhoto = (images) => Array.isArray(images) && images.some((u) => /^https?:\/\//.test(u));

/** Кандидат: у наявності, фото, сумісність, опис > 200 символів */
export const isGood = (p) =>
  p.available === true && hasPhoto(p.images) && String(p.compatibility ?? '').trim() !== '' &&
  plainLength(p.description) > 200;

/**
 * Один той самий товар під сотні авто (кенгурятник на 600 моделей) — майже
 * однакові сторінки, Google таких не індексує. Беремо по одній картці на
 * базову назву, найбагатшу за описом і фото, а категорії чергуємо, щоб карта
 * не складалась з одних кенгурятників.
 */
export function pick(products, limit) {
  const score = (p) => plainLength(p.description) + 150 * Math.min(p.images.length, 5);
  const best = new Map();
  for (const p of products.filter(isGood)) {
    const key = `${p.category}|${(p.name_original || p.name).toLowerCase()}`;
    if (!best.has(key) || score(p) > score(best.get(key))) best.set(key, p);
  }
  const byCat = new Map();
  for (const p of [...best.values()].sort((a, b) => score(b) - score(a))) {
    if (!byCat.has(p.category)) byCat.set(p.category, []);
    byCat.get(p.category).push(p);
  }
  const queues = [...byCat.values()];
  const out = [];
  for (let i = 0; out.length < limit && queues.some((q) => i < q.length); i++) {
    for (const q of queues) if (i < q.length && out.length < limit) out.push(q[i]);
  }
  return out;
}

async function loadAll() {
  const rows = [];
  const fields = 'id,name,name_original,category,compatibility,images,description,available';
  for (let cursor = 0; ; ) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/products?select=${fields}&available=eq.true&id=gt.${cursor}&order=id.asc&limit=${BATCH}`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
    );
    if (!r.ok) throw new Error(`supabase ${r.status}: ${await r.text()}`);
    const batch = await r.json();
    rows.push(...batch);
    if (batch.length < BATCH) return rows;
    cursor = batch[batch.length - 1].id;
    process.stdout.write(`\r${rows.length} товарів…`);
  }
}

function demo() {
  const long = 'x'.repeat(250);
  const base = { available: true, images: ['https://a/1.jpg'], compatibility: 'Audi A4', description: long, category: 'Килимки' };
  assert(isGood(base));
  assert(!isGood({ ...base, description: '<p>' + 'x'.repeat(150) + '</p>' }), 'короткий опис пройшов');
  assert(!isGood({ ...base, images: [] }), 'без фото пройшов');
  assert(!isGood({ ...base, compatibility: ' ' }), 'без сумісності пройшов');
  const items = [
    ...Array.from({ length: 5 }, (_, i) => ({ ...base, id: i, name: `Кенгурятник для авто ${i}`, name_original: 'Кенгурятник', category: 'Кенгурятники' })),
    { ...base, id: 10, name: 'Килимок A', category: 'Килимки' },
    { ...base, id: 11, name: 'Килимок B', category: 'Килимки', images: ['https://a/1', 'https://a/2'] },
    { ...base, id: 12, name: 'Дефлектор', category: 'Дефлектори' },
  ];
  const ids = pick(items, 10).map((p) => p.id);
  assert.equal(ids.filter((id) => id < 5).length, 1, 'дублікати однієї назви пройшли');
  assert.equal(ids.length, 4);
  assert.notEqual(pick(items, 2)[0].category, pick(items, 2)[1].category, 'категорії не чергуються');
}

if (process.argv[1]?.endsWith('sitemap-products.mjs')) {
  demo();
  const all = await loadAll();
  const chosen = pick(all, LIMIT);
  const perCat = {};
  for (const p of chosen) perCat[p.category] = (perCat[p.category] || 0) + 1;
  writeFileSync(OUT,
    '// АВТОГЕНЕРАЦІЯ: node scripts/sitemap-products.mjs — не редагувати вручну.\n' +
    `// Товари для карти сайту (${chosen.length} з ${all.length} у наявності), ${new Date().toISOString().slice(0, 10)}.\n` +
    `export const SITEMAP_PRODUCT_IDS = [\n${chosen.map((p) => p.id).sort((a, b) => a - b).join(',\n')},\n];\n`);
  console.log(`\nВідібрано ${chosen.length} з ${all.length}:`, perCat);
}
