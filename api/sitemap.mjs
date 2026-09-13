// Карта сайту, зібрана на льоту з бази.
//
// Було: два статичні файли в public/ на 12 МБ, які збирав скрипт. Вони
// старіли мовчки (одного разу в карті бракувало 14 490 товарів), а щоб
// оновитись — мусили щодня лягати в git. Автозбірка в CI не рятувала:
// GitHub Actions комітить лише catalogTree.ts, тож зібрана там карта
// викидалась разом із раннером.
//
// Стало: /sitemap.xml — індекс, /sitemap-1.xml — головна, категорії й підбір
// за авто (з бази в момент запиту, кеш на CDN на добу), /sitemap-2.xml —
// відібрані товари.
//
// Товарів у карті — не всі 43 тис., а ~800 найкращих (фото, сумісність,
// опис > 200 символів). Карта на 29 тис. адрес при 4,5 тис. в індексі —
// сигнал низької якості для молодого сайту. Список id готує
// scripts/sitemap-products.mjs; коли ці увійдуть в індекс — наступна хвиля.
//
// Маршрутизація — у vercel.json.

import { SITEMAP_PRODUCT_IDS } from './_lib/sitemapProducts.mjs';

const SITE = 'https://autoshopmarket.com.ua';
const SUPABASE_URL = 'https://vhvedefyixgluayqahhh.supabase.co';
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZodmVkZWZ5aXhnbHVheXFhaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzE0OTEsImV4cCI6MjA5NjY0NzQ5MX0.RMK8MjUTTOO4slWV5kQw5ue7oAkUQyBFhaXhqz3FGtM';

// Supabase віддає максимум 1000 рядків за запит
const BATCH = 1000;

// Занадто дрібні підбірки (1-2 товари) в карту не заявляємо: сторінка майже
// порожня, а краулінговий бюджет витрачається.
const MIN_ITEMS = 3;

const sb = async (path) => {
  const headers = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  return { rows: await r.json() };
};

const toSlug = (s) =>
  String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');

// Кирилиця в шляху — у карті сайту заявляємо її у percent-кодуванні,
// як того вимагає стандарт sitemap
const catalogLoc = (parts) => '/catalog/' + parts.map(encodeURIComponent).join('/');

/**
 * Обгортка <urlset>. entries — { path, lastmod?, priority }.
 * lastmod ставимо лише коли знаємо справжню дату: однакова «сьогоднішня»
 * дата на всіх адресах вчить Google ігнорувати lastmod зовсім.
 * priority: головна 1.0, категорії й підбір 0.8, товари 0.6.
 */
export const urlset = (entries) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  entries.map(({ path, lastmod, priority }) =>
    `  <url><loc>${SITE}${path}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<priority>${priority}</priority></url>`
  ).join('\n') +
  '\n</urlset>\n';

export const SITEMAP_FILES = 2;
export const sitemapIndex = () =>
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  Array.from({ length: SITEMAP_FILES }, (_, i) => `  <sitemap><loc>${SITE}/sitemap-${i + 1}.xml</loc></sitemap>`).join('\n') +
  '\n</sitemapindex>\n';

/** Перша сторінка: головна, категорії й підбір за авто. */
export const hubEntries = (categories, cars) =>
  hubPaths(categories, cars).map((path) => ({ path, priority: path === '/' ? '1.0' : '0.8' }));

export function hubPaths(categories, cars) {
  const paths = ['/'];
  for (const c of categories) paths.push(`/category/${encodeURIComponent(c.replace(/\//g, '-'))}`);

  const seenMarks = new Set();
  for (const row of cars) {
    const markSlug = toSlug(row.mark);
    const modelSlug = toSlug(row.model);
    if (!markSlug) continue;
    if (!seenMarks.has(markSlug)) {
      seenMarks.add(markSlug);
      paths.push(catalogLoc([markSlug]));
    }
    if (!modelSlug) continue;
    // Рядок «модель = марка» (Acura/Acura) — це кошик універсальних товарів
    // бренду, тобто та сама адреса, що /catalog/<марка>. Окремо не заявляємо,
    // а її категорії йдуть під заглушкою «usi» — рівно та адреса, яку
    // сторінка вказує в canonical.
    const brandWide = modelSlug === markSlug;
    if (!brandWide) paths.push(catalogLoc([markSlug, modelSlug]));
    const modelSeg = brandWide ? 'usi' : modelSlug;
    for (const [cat, subs] of Object.entries(row.categories || {})) {
      const total = Object.values(subs).reduce((a, b) => a + b, 0);
      if (total >= MIN_ITEMS) paths.push(catalogLoc([markSlug, modelSeg, toSlug(cat)]));
    }
  }
  return paths;
}

async function loadHub() {
  // Довідник авто й перелік категорій незалежні — тягнемо одночасно
  const [cars, categories] = await Promise.all([loadCars(), loadCategories()]);
  return { cars, categories };
}

async function loadCars() {
  const cars = [];
  for (let start = 0; ; start += BATCH) {
    const { rows } = await sb(`car_models?select=mark,model,categories&order=mark.asc,model.asc&offset=${start}&limit=${BATCH}`);
    cars.push(...rows);
    if (rows.length < BATCH) break;
  }
  return cars;
}

/**
 * Список категорій. PostgREST не вміє DISTINCT, а сканувати 72 тис. рядків
 * заради 36 назв не влазить у таймаут. Тому йдемо по індексу
 * (category, id desc) стрибками: беремо найменшу назву, потім першу більшу
 * за неї — кожен крок це пошук по індексу.
 *
 * Впирається не в базу, а в мережу: 36 кроків поспіль — це 36 звернень по
 * ~130 мс, разом ~5 с при ліміті функції Vercel 10 с. Тому алфавіт розбито
 * на відрізки й обходи йдуть паралельно.
 *
 * Довідник авто для цього не годиться: категорії власного складу
 * (автохімія, COLOURLOCK) з жодним авто не пов'язані, і в карті бракувало
 * 16 сторінок із 36.
 */
const CATEGORY_SEEDS = ['', 'А', 'Ж', 'Л', 'Р', 'Ф'];

async function loadCategories() {
  const walks = await Promise.all(
    CATEGORY_SEEDS.map((lo, i) => walkCategories(lo, CATEGORY_SEEDS[i + 1]))
  );
  return [...new Set(walks.flat())].sort();
}

async function walkCategories(lo, hi) {
  const out = [];
  let cursor = lo;
  const upper = hi ? `&category=lt.${encodeURIComponent(hi)}` : '';
  for (let i = 0; i < 50; i++) {
    const after = cursor ? `&category=gt.${encodeURIComponent(cursor)}` : '';
    const { rows } = await sb(
      `products?select=category&category=not.is.null${after}${upper}&order=category.asc&limit=1`
    );
    if (!rows.length) break;
    cursor = rows[0].category;
    out.push(cursor);
  }
  return out;
}

// Один повтор: запит до бази зрідка відвалюється по таймауту.
const retry = async (fn) => {
  try { return await fn(); }
  catch { await new Promise((r) => setTimeout(r, 400)); return fn(); }
};

/**
 * Відібрані товари. Наявність перевіряємо щоразу: товар, який зник або
 * закінчився після відбору, у карту не заявляємо. lastmod — created_at:
 * колонки updated_at у таблиці немає.
 */
export const productEntries = (rows) =>
  rows.map((p) => ({ path: `/product/${p.id}`, lastmod: String(p.created_at ?? '').slice(0, 10) || null, priority: '0.6' }));

async function loadProducts(ids = SITEMAP_PRODUCT_IDS) {
  const chunks = [];
  // id у URL: 200 штук — ~1,5 КБ адреси, з запасом під ліміти
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
  const parts = await Promise.all(chunks.map((c) =>
    retry(() => sb(`products?select=id,created_at&available=eq.true&id=in.(${c.join(',')})&order=id.asc&limit=${BATCH}`))
  ));
  return parts.flatMap((p) => p.rows);
}


export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  // Карта потрібна роботу, а не людині: збираємо раз на добу, далі з CDN
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');

  const raw = req.query?.page;
  const page = Number(Array.isArray(raw) ? raw[0] : raw);

  try {
    if (!Number.isInteger(page) || page < 1) return res.status(200).send(sitemapIndex());
    if (page === 1) {
      const { cars, categories } = await retry(loadHub);
      return res.status(200).send(urlset(hubEntries(categories, cars)));
    }
    if (page === 2) return res.status(200).send(urlset(productEntries(await loadProducts())));
    return res.status(404).send(urlset([]));
  } catch (err) {
    console.error('sitemap:', err.message);
    // Порожня, але валідна карта краще за 500: Google повторить пізніше,
    // а вже відомі йому адреси з індексу не зникнуть.
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.status(200).send(urlset([]));
  }
}

// ─── Самоперевірка: node api/sitemap.mjs ────────────────────
async function demo() {
  const { default: assert } = await import('node:assert/strict');

  // індекс: хаб + відібрані товари
  const idx = sitemapIndex();
  assert.match(idx, /<sitemapindex/);
  assert.equal((idx.match(/<sitemap>/g) || []).length, 2);
  assert.match(idx, /sitemap-2\.xml/);
  assert.ok(!idx.includes('sitemap-3.xml'));
  assert.ok(SITEMAP_PRODUCT_IDS.length >= 500 && SITEMAP_PRODUCT_IDS.length <= 2000, 'товарів у карті не 500–2000');

  // хаб: головна + категорії + підбір
  const cars = [
    { mark: 'Volkswagen', model: 'Volkswagen Passat B5 1997-2005', categories: { 'Килимки': { 'EVA': 12 }, 'Чохли': { 'Шкіра': 1 } } },
    { mark: 'Volkswagen', model: 'Volkswagen Golf 7 2012-2020', categories: {} },
    { mark: 'Acura', model: 'Acura', categories: { 'Килимки': { 'EVA': 5 } } },
  ];
  const paths = hubPaths(['Килимки', 'Багажники/Дуги на дах'], cars);
  assert.equal(paths[0], '/');
  // коса риска в назві категорії міняється на дефіс — як в адресах сайту
  assert.ok(paths.includes('/category/' + encodeURIComponent('Багажники-Дуги на дах')));
  // марка заявлена один раз, попри два рядки моделей
  assert.equal(paths.filter((p) => p === '/catalog/volkswagen').length, 1);
  assert.ok(paths.includes('/catalog/volkswagen/volkswagen-passat-b5-1997-2005'));
  // категорія з 12 товарами є, з одним — ні (MIN_ITEMS)
  assert.ok(paths.some((p) => p.includes('volkswagen-passat-b5-1997-2005') && p.includes(encodeURIComponent('килимки'))));
  assert.ok(!paths.some((p) => p.includes(encodeURIComponent('чохли'))), 'підбірка з 1 товару потрапила в карту');
  // «модель = марка» окремою адресою не заявляється, категорії йдуть під usi
  assert.ok(!paths.includes('/catalog/acura/acura'));
  assert.ok(paths.some((p) => p.startsWith('/catalog/acura/usi/')));

  // urlset: пріоритети й справжній lastmod
  const hub = urlset(hubEntries(['Килимки'], []));
  assert.match(hub, /<loc>https:\/\/autoshopmarket\.com\.ua\/<\/loc><priority>1\.0<\/priority>/);
  assert.match(hub, /Килимки|%D0%9A/);
  assert.match(hub, /<priority>0\.8<\/priority>/);
  assert.ok(!hub.includes('<lastmod>'), 'хабу вигадано дату');
  const xml = urlset(productEntries([{ id: 42, created_at: '2026-07-15T07:06:27+00:00' }, { id: 43 }]));
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<loc>https:\/\/autoshopmarket\.com\.ua\/product\/42<\/loc><lastmod>2026-07-15<\/lastmod><priority>0\.6<\/priority>/);
  assert.match(xml, /product\/43<\/loc><priority>0\.6/);
  assert.ok(!xml.includes('changefreq'));
  // порожня карта лишається валідною
  assert.match(urlset([]), /<urlset[^>]*>\s*<\/urlset>/);

  console.log('ok');
}

if (process.argv[1]?.endsWith('sitemap.mjs')) demo();
