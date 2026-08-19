// Карта сайту, зібрана на льоту з бази.
//
// Було: два статичні файли в public/ на 12 МБ, які збирав скрипт. Вони
// старіли мовчки (одного разу в карті бракувало 14 490 товарів), а щоб
// оновитись — мусили щодня лягати в git. Автозбірка в CI не рятувала:
// GitHub Actions комітить лише catalogTree.ts, тож зібрана там карта
// викидалась разом із раннером.
//
// Стало: /sitemap.xml — індекс, /sitemap-N.xml — сторінки. Дані беруться
// з бази в момент запиту й кешуються на CDN на добу. Карта завжди свіжа,
// репозиторій не росте, від імпорту нічого не залежить.
//
// Маршрутизація — у vercel.json. Файл самодостатній (без локальних
// імпортів) — вимога стабільної роботи на Vercel.

const SITE = 'https://autoshopmarket.com.ua';
const SUPABASE_URL = 'https://vhvedefyixgluayqahhh.supabase.co';
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZodmVkZWZ5aXhnbHVheXFhaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzE0OTEsImV4cCI6MjA5NjY0NzQ5MX0.RMK8MjUTTOO4slWV5kQw5ue7oAkUQyBFhaXhqz3FGtM';

// Supabase віддає максимум 1000 рядків за запит, тож сторінка карти — це
// PAGE_BATCHES паралельних запитів. 8000 адрес ≈ 700 КБ відповіді: з запасом
// під ліміт Vercel (4,5 МБ) і під ліміт Google (50 000 адрес на файл).
const BATCH = 1000;
const PAGE_BATCHES = 8;
const CHUNK = BATCH * PAGE_BATCHES;

// Заглушки постачальника в карту не заявляємо
const PLACEHOLDER = 'Замовити будь-який товар*';
// Спільний фільтр товарів: у наявності й не заглушка
const LIVE = `available=eq.true&name=not.ilike.${encodeURIComponent(PLACEHOLDER)}`;

// Занадто дрібні підбірки (1-2 товари) в карту не заявляємо: сторінка майже
// порожня, а краулінговий бюджет витрачається.
const MIN_ITEMS = 3;

const sb = async (path, { count = false } = {}) => {
  const headers = { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` };
  // Точний count по available падає по таймауту — індексу на цій колонці
  // немає. Оцінка планувальника віддається за ~300 мс і розходиться
  // з реальністю менш ніж на 1%: для «скільки файлів» цього досить.
  if (count) { headers.Prefer = 'count=estimated'; headers.Range = '0-0'; }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  return { rows: await r.json(), range: r.headers.get('content-range') };
};

const toSlug = (s) =>
  String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');

// Кирилиця в шляху — у карті сайту заявляємо її у percent-кодуванні,
// як того вимагає стандарт sitemap
const catalogLoc = (parts) => '/catalog/' + parts.map(encodeURIComponent).join('/');

const today = () => new Date().toISOString().slice(0, 10);

/** Обгортка <urlset>. changefreq і priority свідомо не пишемо: Google їх
 *  офіційно ігнорує, а вони роздували відповідь удвічі. */
export const urlset = (paths) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  paths.map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${today()}</lastmod></url>`).join('\n') +
  '\n</urlset>\n';

export const sitemapIndex = (count) =>
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  Array.from({ length: count }, (_, i) =>
    `  <sitemap><loc>${SITE}/sitemap-${i + 1}.xml</loc><lastmod>${today()}</lastmod></sitemap>`
  ).join('\n') +
  '\n</sitemapindex>\n';

/**
 * Скільки всього файлів. Точний count по available падає по таймауту
 * (індексу на цю колонку немає), тому беремо оцінку планувальника — вона
 * розходиться з реальністю менш ніж на 1%. Запас 10% на випадок, якщо
 * оцінка виявиться заниженою: зайвий файл віддасть порожній, але валідний
 * urlset, а от загублені адреси Google уже не побачить.
 */
export function fileCount(estimate) {
  const products = Math.ceil((estimate * 1.1) / CHUNK);
  return 1 + Math.max(1, products); // 1-й файл — головна, категорії, підбір
}

/** Перша сторінка: головна, категорії й підбір за авто. */
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
 * Межа сторінки N: id товару на позиції N*CHUNK у ПОВНІЙ таблиці, без
 * фільтра наявності.
 *
 * Чому без фільтра: offset із `available=eq.true` на глибині коштує
 * 0,4-3 с і на Vercel стабільно відвалювався — сторінки 3-8 віддавали
 * порожню карту, хоча локально збирались. Той самий offset по чистому
 * первинному ключу — 255-300 мс і жодного збою.
 *
 * Нерівність сторінок від цього не страшна: важливо, щоб діапазони
 * покривали всі товари й не перетинались, а скільки саме адрес у кожному
 * файлі — Google байдуже, доки їх менше 50 000.
 */
async function boundaryId(nth) {
  const { rows } = await retry(() =>
    sb(`products?select=id&order=id.asc&offset=${nth - 1}&limit=1`)
  );
  return rows.length ? rows[0].id : null;
}

/**
 * Сторінка N товарів: keyset-обхід у межах діапазону id.
 * Заміряно: keyset — стабільні 155-235 мс на 1000 рядків, offset на
 * глибині — до 3 с і час від часу 500.
 */
async function loadProductPage(page) {
  const lo = page === 1 ? 0 : await boundaryId((page - 1) * CHUNK);
  if (lo === null) return [];                       // сторінка за межами каталогу
  const hiId = await boundaryId(page * CHUNK);      // null на останній сторінці
  const upper = hiId === null ? '' : `&id=lte.${hiId}`;

  const out = [];
  let cursor = lo;
  for (let i = 0; i < CHUNK / BATCH + 2; i++) {
    const { rows } = await retry(() =>
      sb(`products?select=id&${LIVE}&id=gt.${cursor}${upper}&order=id.asc&limit=${BATCH}`)
    );
    if (!rows.length) break;
    out.push(...rows);
    cursor = rows[rows.length - 1].id;
    if (rows.length < BATCH) break;
  }
  return out.map((p) => `/product/${p.id}`);
}


export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  // Карта потрібна роботу, а не людині: збираємо раз на добу, далі з CDN
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');

  const raw = req.query?.page;
  const page = Number(Array.isArray(raw) ? raw[0] : raw);

  try {
    if (!Number.isInteger(page) || page < 1) {
      const { range } = await sb('products?select=id', { count: true });
      return res.status(200).send(sitemapIndex(fileCount(estimateFrom(range))));
    }
    if (page === 1) {
      const { cars, categories } = await loadHub();
      return res.status(200).send(urlset(hubPaths(categories, cars)));
    }
    return res.status(200).send(urlset(await loadProductPage(page - 1)));
  } catch (err) {
    console.error('sitemap:', err.message);
    // Порожня, але валідна карта краще за 500: Google повторить пізніше,
    // а вже відомі йому адреси з індексу не зникнуть.
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.status(200).send(urlset([]));
  }
}

/** «0-0/50893» → 50893 */
export const estimateFrom = (range) => Number(String(range ?? '').split('/')[1]) || 0;

// ─── Самоперевірка: node api/sitemap.mjs ────────────────────
async function demo() {
  const { default: assert } = await import('node:assert/strict');

  // індекс
  assert.equal(estimateFrom('0-0/50893'), 50893);
  assert.equal(estimateFrom(null), 0);
  // 50893 товарів → 8000 на файл → 7 файлів товарів + 1 хаб
  assert.equal(fileCount(50893), 8);
  assert.equal(fileCount(0), 2, 'порожній каталог усе одно має хаб і одну сторінку');
  const idx = sitemapIndex(fileCount(50893));
  assert.match(idx, /<sitemapindex/);
  assert.equal((idx.match(/<sitemap>/g) || []).length, 8);
  assert.match(idx, /sitemap-1\.xml/);
  assert.match(idx, /sitemap-8\.xml/);
  assert.ok(!idx.includes('sitemap-9.xml'));

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

  // urlset
  const xml = urlset(['/', '/product/42']);
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<loc>https:\/\/autoshopmarket\.com\.ua\/product\/42<\/loc>/);
  assert.match(xml, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  // changefreq/priority прибрані свідомо — Google їх ігнорує
  assert.ok(!xml.includes('changefreq'));
  assert.ok(!xml.includes('priority'));
  // порожня карта лишається валідною
  assert.match(urlset([]), /<urlset[^>]*>\s*<\/urlset>/);

  console.log('ok');
}

if (process.argv[1]?.endsWith('sitemap.mjs')) demo();
