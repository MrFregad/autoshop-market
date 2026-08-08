// Серверна підстановка мети для /product/:id і /category/:cat[/:sub].
//
// Навіщо: сайт — CSR SPA, у HTML лише <div id="root"></div>. Google рендерить,
// а GPTBot / PerplexityBot / ClaudeBot JS не виконують — вони бачили порожню
// сторінку. Гірше: index.html віддавався байт-у-байт на всі 72k адрес, тобто
// кожна картка товару заявляла <link rel="canonical" href="/"> — пряма команда
// «викинь мене з індексу».
//
// Функція бере готову оболонку index.html, підмінює title / description /
// canonical / og:*, додає Product JSON-LD і текстовий блок у #root (React його
// затирає при монтуванні). Відповідь кешується на CDN, тож Supabase смикається
// раз на добу на адресу, а не на кожен запит.
//
// Маршрутизація — у vercel.json (rewrites перед catch-all на /index.html).

const SITE = 'https://autoshopmarket.com.ua';
const SUPABASE_URL = 'https://vhvedefyixgluayqahhh.supabase.co';
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZodmVkZWZ5aXhnbHVheXFhaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzE0OTEsImV4cCI6MjA5NjY0NzQ5MX0.RMK8MjUTTOO4slWV5kQw5ue7oAkUQyBFhaXhqz3FGtM';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Опис у БД може містити HTML — для <meta> потрібен чистий текст.
// keepBreaks — для видимого блоку: опис іде рядками «Матеріал: …\nСумісність: …»,
// склеювати їх в одну кашу не можна ні для читача, ні для краулера.
const plain = (s, n = 300, keepBreaks = false) => {
  const t = String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(keepBreaks ? /[^\S\n]+/g : /\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};

// Обгортка для тексту в #root: доки не завантажився React, сторінка має
// виглядати як звичайна картка, а не як неоформлена розмітка
const wrap = (inner) =>
  `<div style="font:16px/1.55 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1e1b2e;` +
  `max-width:920px;margin:0 auto;padding:24px 20px">${inner}</div>`;

// Підміна одного тега <meta …/> (у шаблоні вони багаторядкові)
const setMeta = (html, key, value) =>
  html.replace(new RegExp(`<meta\\s+${key}[\\s\\S]*?/>`), `<meta ${key} content="${esc(value)}" />`);

/** Збирає готовий HTML із оболонки. Чиста функція — її й перевіряє demo() внизу. */
export function injectMeta(shell, { title, description, canonical, image, jsonLd, body }) {
  let html = shell
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${esc(canonical)}" />`);

  html = setMeta(html, 'name="description"', description);
  html = setMeta(html, 'property="og:url"', canonical);
  html = setMeta(html, 'property="og:title"', title);
  html = setMeta(html, 'property="og:description"', description);
  html = setMeta(html, 'name="twitter:title"', title);
  html = setMeta(html, 'name="twitter:description"', description);
  if (image) {
    html = setMeta(html, 'property="og:image"', image);
    html = setMeta(html, 'name="twitter:image"', image);
  }

  if (jsonLd) {
    // JSON.stringify екранує </script> недостатньо — ріжемо косу риску
    const safe = JSON.stringify(jsonLd).replace(/</g, '\\u003c');
    html = html.replace('</head>', `  <script type="application/ld+json">${safe}</script>\n  </head>`);
  }

  // В оболонці #root не порожній (там статичні посилання на категорії для
  // краулера), тому міняємо весь блок, а не порожній тег
  if (body) html = html.replace(/<div id="root">[\s\S]*?<\/div>\s*(?=<script)/, `<div id="root">${body}</div>\n    `);

  return html;
}

// Обрізає рядок по межі слова
const clip = (s, n) => {
  const t = String(s ?? '').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  return cut.slice(0, cut.lastIndexOf(' ') > n * 0.6 ? cut.lastIndexOf(' ') : n).trimEnd() + '…';
};

// Головне для авторинку: «килимки» шукають не самі по собі, а під конкретне авто.
// У БД сумісність лежить у models[] / compatibility — без неї 41 719 адрес мали
// однакові заголовки («Гумові килимки Carsuit (Бежевий)» × 696) і Google бачив
// дублікати замість 696 різних цільових сторінок.
const carFit = (p) => {
  const list = Array.isArray(p.models) ? p.models.filter(Boolean) : [];
  return { first: list[0] || String(p.compatibility ?? '').split(',')[0].trim(), all: list.join(', ') || String(p.compatibility ?? '') };
};

// ─── Список товарів на хаб-сторінці ─────────────────────────
// Без нього категорія — це h1 і абзац, тобто тупик: на сайті немає жодного
// посилання на картку товару, і всі 58 тис. адрес існують лише в sitemap.
// Саме так виглядає «Обнаружена, не проиндексирована» в Search Console —
// Google знає адресу, але не бачить, звідки на неї ходять.
const HUB_LIMIT = 48;

const productLinks = (items) =>
  items.length
    ? '<ul style="list-style:none;padding:0;margin:16px 0 0;display:grid;gap:10px">' +
      items
        .map(
          (p) =>
            `<li><a href="/product/${encodeURIComponent(p.id)}" style="color:#6d28d9;text-decoration:none">${esc(p.name)}</a>` +
            ` — <span style="white-space:nowrap">${esc(p.price)} грн</span></li>`
        )
        .join('') +
      '</ul>'
    : '';

// Помилка тут не повинна ламати сторінку — просто лишиться без списку
async function hubProducts(filter) {
  try {
    return await sbGet(
      `products?select=id,name,price&${filter}&available=not.is.false&order=id.desc&limit=${HUB_LIMIT}`
    );
  } catch {
    return [];
  }
}

// PostgREST: елемент масиву з пробілами/комами треба брати в лапки
const arrayContains = (col, value) => `${col}=cs.${encodeURIComponent(`{"${value}"}`)}`;

async function fetchProduct(id) {
  const fields =
    'id,name,category,subcategory,price,images,brand,condition,description,compatibility,models,available';
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(id)}&select=${fields}&limit=1`,
    { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
  );
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  const [p] = await r.json();
  return p ?? null;
}

export function productPage(shell, p) {
  const canonical = `${SITE}/product/${p.id}`;
  const image = Array.isArray(p.images) ? p.images[0] : null;
  const fit = carFit(p);
  const inStock = p.available !== false;

  const title = clip(`${p.name}${fit.first ? ` для ${fit.first}` : ''}`, 65) + ' | AutoShop Market';
  const description = clip(
    `${p.name}${fit.all ? ` — сумісність: ${fit.all}.` : '.'} Ціна ${p.price} грн.` +
      `${inStock ? ' В наявності.' : ' Немає в наявності.'} Доставка Новою Поштою по Україні.`,
    300
  );

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    sku: String(p.id),
    url: canonical,
    ...(image ? { image } : {}),
    ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {}),
    ...(p.category ? { category: [p.category, p.subcategory].filter(Boolean).join(' / ') } : {}),
    ...(fit.all
      ? {
          isAccessoryOrSparePartFor: (Array.isArray(p.models) && p.models.length
            ? p.models
            : [fit.all]
          ).map((m) => ({ '@type': 'Product', name: m })),
        }
      : {}),
    description: plain(p.description, 900) || p.name,
    offers: {
      '@type': 'Offer',
      url: canonical,
      price: String(p.price),
      priceCurrency: 'UAH',
      availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition:
        (p.condition || '').toLowerCase().startsWith('б') ||
        (p.condition || '').toLowerCase().includes('вжив')
          ? 'https://schema.org/UsedCondition'
          : 'https://schema.org/NewCondition',
      seller: { '@id': `${SITE}/#organization` },
    },
  };

  // Цей блок бачать краулери без JS; React затирає його при монтуванні.
  // Інлайн-стилі — щоб до завантаження бандла показувалась не «гола» розмітка,
  // а читабельна картка: користувач бачить назву й ціну одразу (швидший LCP).
  const body = wrap(
    `<h1 style="font-size:26px;line-height:1.25;margin:0 0 12px">${esc(p.name)}</h1>` +
      (fit.all ? `<p style="margin:0 0 12px;color:#4b5563">Сумісність: ${esc(fit.all)}</p>` : '') +
      (p.brand ? `<p style="margin:0 0 4px;color:#4b5563">Бренд: ${esc(p.brand)}</p>` : '') +
      `<p style="font-size:24px;font-weight:700;color:#6d28d9;margin:0 0 4px">${esc(p.price)} грн</p>` +
      `<p style="margin:0 0 16px;color:${inStock ? '#15803d' : '#b91c1c'}">${inStock ? 'В наявності' : 'Немає в наявності'}</p>` +
      (image
        ? `<img src="${esc(image)}" alt="${esc(p.name)}" style="max-width:100%;height:auto;border-radius:12px;margin:0 0 16px" />`
        : '') +
      `<p style="white-space:pre-line;margin:0">${esc(plain(p.description, 1200, true))}</p>`
  );

  return injectMeta(shell, { title, description, canonical, image, jsonLd, body });
}

export function categoryPage(shell, cat, sub, items = []) {
  const name = sub || cat;
  const canonical = `${SITE}/category/${encodeURIComponent(cat)}${sub ? `/${encodeURIComponent(sub)}` : ''}`;
  const title = `${name} — купити в Україні | AutoShop Market`;
  const description = `${name}: великий вибір автотоварів за цінами постачальника. Доставка Новою Поштою по всій Україні, оплата при отриманні.`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name,
    url: canonical,
    description,
    isPartOf: { '@id': `${SITE}/#website` },
  };

  return injectMeta(shell, {
    title,
    description,
    canonical,
    jsonLd,
    body: wrap(
      `<h1 style="font-size:26px;line-height:1.25;margin:0 0 12px">${esc(name)}</h1>` +
        `<p style="margin:0;color:#4b5563">${esc(description)}</p>` +
        productLinks(items)
    ),
  });
}

// ─── Каталог за авто: /catalog/<марка>/<модель>/<категорія> ──
// Сегменти адреси — «людські» (volkswagen-passat-b5-1997-2005). Для заголовка
// потрібна справжня назва з довідника, інакше «1997-2005» розпадається на два
// слова. Марку відбираємо запитом (ilike), модель добираємо звіркою слагів.
const ANY_SEGMENT = 'usi';
const toSlug = (s) =>
  String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');

const sbGet = async (path) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  return r.json();
};

/**
 * Зіставляє сегменти адреси з довідником авто.
 * null — такої марки/моделі/категорії немає, сторінку віддаємо як 404.
 *
 * Навіщо сувора перевірка: раніше будь-який рядок у шляху ставав сторінкою
 * («/catalog/volkswagen/neisnuyucha-model-999» → 200 з index,follow). Це
 * фабрика дублікатів — нескінченна кількість адрес з майже однаковим текстом,
 * за що Google знижує довіру до всього домену.
 */
export async function resolveCatalog([markSlug, modelSlug, catSlug, subSlug]) {
  if (!markSlug) return { mark: '', model: '', category: '', sub: '' };

  const rows = await sbGet(
    `car_models?select=mark,model&mark=ilike.${encodeURIComponent(markSlug.replace(/-/g, '%'))}&limit=1000`
  );
  const mark = rows.find((x) => toSlug(x.mark) === markSlug)?.mark;
  if (!mark) return null;

  let model = '';
  if (modelSlug) {
    const models = rows.filter((x) => x.mark === mark).map((x) => x.model);
    model =
      models.find((m) => toSlug(m) === modelSlug) ||
      models.find((m) => toSlug(m).includes(modelSlug)) ||
      '';
    if (!model) return null;
  }

  let category = '';
  let sub = '';
  if (catSlug) {
    // Які категорії взагалі є в цього авто — знає той самий довідник
    const q = `mark=eq.${encodeURIComponent(mark)}` + (model ? `&model=eq.${encodeURIComponent(model)}` : '');
    const merged = {};
    for (const row of await sbGet(`car_models?select=categories&${q}&limit=500`)) {
      for (const [c, subs] of Object.entries(row.categories || {})) {
        merged[c] ??= new Set();
        for (const s of Object.keys(subs)) merged[c].add(s);
      }
    }
    category = Object.keys(merged).find((c) => toSlug(c) === catSlug) || '';
    if (!category) return null;
    if (subSlug) {
      sub = [...merged[category]].find((s) => toSlug(s) === subSlug) || '';
      if (!sub) return null;
    }
  }

  return { mark, model, category, sub };
}

// Канонічну адресу збираємо зі слагів, а не з req.url: після rewrite Vercel
// передає сюди вже /api/meta?…, і canonical вказував би на службовий шлях.
export function catalogHref(slugs) {
  const seg = slugs.map((s) => s || '');
  while (seg.length && !seg[seg.length - 1]) seg.pop();
  if (!seg.length) return '/catalog';
  return '/catalog/' + seg.map((s) => s || ANY_SEGMENT).join('/');
}

export function catalogPage(shell, { mark, model, category, sub }, items = []) {
  const car = [mark, model].filter(Boolean).join(' ');
  const what = sub || category || 'Автотовари та тюнінг';
  const name = car ? `${what} для ${model || mark}` : what;

  // Canonical збираємо зі справжніх назв, а не з того, що написано в адресі:
  // /catalog/volkswagen/passat-b5 і повний слаг — це одна сторінка, і кожна
  // мусить вказувати на повний варіант, інакше Google бачить два дублікати.
  // Модель, що дорівнює марці («/catalog/acura/acura») — теж сама марка.
  const modelSlug = !model || toSlug(model) === toSlug(mark) ? '' : toSlug(model);
  const canonical =
    SITE + catalogHref([toSlug(mark), modelSlug, toSlug(category), toSlug(sub)]);

  const title = clip(name, 62) + ' | AutoShop Market';
  const description = clip(
    `${name} — модельний підбір${car ? ` під ${car}` : ''}. Ціни постачальника, ` +
      `перевірена сумісність, доставка Новою Поштою по всій Україні, оплата при отриманні.`,
    300
  );

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name,
    url: canonical,
    description,
    isPartOf: { '@id': `${SITE}/#website` },
    ...(car ? { about: { '@type': 'Product', name: car } } : {}),
  };

  return injectMeta(shell, {
    title,
    description,
    canonical,
    jsonLd,
    body: wrap(
      `<h1 style="font-size:26px;line-height:1.25;margin:0 0 12px">${esc(name)}</h1>` +
        `<p style="margin:0;color:#4b5563">${esc(description)}</p>` +
        productLinks(items)
    ),
  });
}

// Оболонка однакова для всього деплою — тягнемо раз на інстанс
let shellCache = null;
async function getShell(host) {
  if (shellCache) return shellCache;
  const r = await fetch(`https://${host}/index.html`);
  if (!r.ok) throw new Error(`shell ${r.status}`);
  shellCache = await r.text();
  return shellCache;
}

export default async function handler(req, res) {
  const { type, id, cat, sub, mark, model } = req.query ?? {};
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  let shell;
  try {
    shell = await getShell(req.headers.host);
  } catch {
    // без оболонки віддати нічого не можемо — хай Vercel покаже статику
    return res.status(302).setHeader('Location', '/').end();
  }

  try {
    if (type === 'product') {
      const p = await fetchProduct(id);
      // товару немає — чесний 404, щоб Google прибрав мертву адресу з індексу
      if (!p) return res.status(404).send(shell);
      res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
      return res.status(200).send(productPage(shell, p));
    }
    if (type === 'catalog') {
      const seg = (v) => (v && v !== ANY_SEGMENT ? decodeURIComponent(v) : '');
      const found = await resolveCatalog([seg(mark), seg(model), seg(cat), seg(sub)]);
      // Такого авто (чи категорії в нього) немає — чесний 404, інакше під будь-який
      // набір літер у шляху народжувалась би нова сторінка для індексу
      if (!found) return res.status(404).send(shell);
      const filter = [
        found.model ? arrayContains('models', found.model) : arrayContains('marks', found.mark),
        found.category && `category=eq.${encodeURIComponent(found.category)}`,
        found.sub && `subcategory=eq.${encodeURIComponent(found.sub)}`,
      ].filter(Boolean).join('&');
      res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
      return res.status(200).send(catalogPage(shell, found, await hubProducts(filter)));
    }
    const catName = decodeURIComponent(cat ?? '');
    const subName = sub && decodeURIComponent(sub);
    // В адресі коса риска категорії замінена дефісом (categorySlug в App.tsx):
    // «Багажники-Дуги на дах» у БД зветься «Багажники/Дуги на дах».
    // Жодна категорія верхнього рівня дефіса в назві не має, тож заміна безпечна.
    const catFilter = [
      `category=eq.${encodeURIComponent(catName.replace(/-/g, '/'))}`,
      subName && `subcategory=eq.${encodeURIComponent(subName)}`,
    ].filter(Boolean).join('&');
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).send(categoryPage(shell, catName, subName, await hubProducts(catFilter)));
  } catch (err) {
    // сторінка не повинна падати через Supabase — віддаємо звичайну оболонку
    console.error('meta:', err.message);
    return res.status(200).send(shell);
  }
}

// ─── Самоперевірка: node api/meta.mjs ───────────────────────
async function demo() {
  const { default: assert } = await import('node:assert/strict');
  const { readFileSync } = await import('node:fs');
  const shell = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  const base = {
    id: 271389,
    name: 'Дефлектор "Х" & <тест>',
    category: 'Дефлектори',
    subcategory: null,
    price: 450,
    images: ['https://cdn.example/a.jpg'],
    brand: 'Heko',
    condition: 'Новий',
    description: '<p>Опис із <b>HTML</b> та лапками "тут"</p>',
    compatibility: 'Toyota Camry 2011–2017, Audi A4 B8 2007-2015',
    models: ['Toyota Camry 2011–2017', 'Audi A4 B8 2007-2015'],
    available: true,
  };
  const html = productPage(shell, base);

  assert.match(html, /<link rel="canonical" href="https:\/\/autoshopmarket\.com\.ua\/product\/271389" \/>/);
  assert.ok(!html.includes('<link rel="canonical" href="https://autoshopmarket.com.ua/" />'), 'старий canonical лишився');
  assert.match(html, /"@type":"Product"/);
  assert.match(html, /"price":"450"/);
  assert.ok(!/"description":"[^"]*<p>/.test(html), 'HTML протік у JSON-LD description');
  assert.match(html, /content="https:\/\/cdn\.example\/a\.jpg"/);

  // сумісність робить заголовок унікальним — інакше 696 однакових <title>
  assert.match(html, /<title>[^<]*Toyota Camry/, 'модель авто не потрапила в title');
  assert.ok(/<title>([\s\S]*?)<\/title>/.exec(html)[1].length <= 90, 'title задовгий');
  assert.match(html, /"isAccessoryOrSparePartFor":\[\{"@type":"Product","name":"Toyota Camry/);
  assert.match(html, /content="[^"]*сумісність: Toyota Camry 2011–2017, Audi A4/);

  // екранування працює і всередині стилізованої обгортки
  assert.match(html, /<h1[^>]*>Дефлектор &quot;Х&quot; &amp; &lt;тест&gt;<\/h1>/);
  assert.match(html, /<div id="root"><div style="font:16px/);

  // рядки опису лишаються рядками у видимому блоці, але не в <meta>
  const multi = productPage(shell, { ...base, description: 'Матеріал: Гума\nВстановлення: В штатні місця' });
  assert.match(multi, /Матеріал: Гума\nВстановлення/, 'переноси в описі втрачені');
  assert.ok(!/content="[^"]*Гума\n/.test(multi), 'перенос протік у <meta>');

  // наявність не можна хардкодити — 14 286 товарів у БД available=false
  assert.match(html, /schema\.org\/InStock/);
  const outHtml = productPage(shell, { ...base, available: false });
  assert.match(outHtml, /schema\.org\/OutOfStock/);
  assert.ok(!outHtml.includes('schema.org/InStock'), 'InStock лишився для недоступного товару');
  assert.match(outHtml, /Немає в наявності/);

  const catHtml = categoryPage(shell, "Інтер'єр", null, [
    { id: 42, name: 'Килимок EVA "тест"', price: 990 },
  ]);
  assert.match(catHtml, /<link rel="canonical" href="[^"]*\/category\/%D0%86/);
  assert.match(catHtml, /"@type":"CollectionPage"/);

  // Хаб без посилань на товари = сторінка-тупик: саме через це 58 тис. карток
  // висіли в Search Console як «обнаружена, не проиндексирована»
  assert.match(catHtml, /<a href="\/product\/42"[^>]*>Килимок EVA &quot;тест&quot;<\/a>/);
  assert.match(catHtml, /990 грн/);
  assert.ok(!/aria-label="Категорії каталогу"/.test(catHtml), 'статична навігація оболонки лишилась у тілі');
  const catalogWithItems = catalogPage(
    shell,
    { mark: 'Skoda', model: '', category: 'Килимки', sub: '' },
    [{ id: 7, name: 'Килимок Skoda', price: 1 }]
  );
  assert.match(catalogWithItems, /<a href="\/product\/7"/);

  // ── каталог за авто ──
  const vw = { mark: 'Volkswagen', model: 'Volkswagen Passat B5 1997-2005', category: 'Килимки', sub: '' };
  const cars = catalogPage(shell, vw);
  assert.match(cars, /<title>Килимки для Volkswagen Passat B5 1997-2005/);
  assert.ok(/<title>([\s\S]*?)<\/title>/.exec(cars)[1].length <= 90, 'title задовгий');
  assert.match(cars, /<h1[^>]*>Килимки для Volkswagen Passat B5 1997-2005<\/h1>/);

  // canonical будується з назв, а не з адреси: коротка адреса
  // /catalog/volkswagen/passat-b5 мусить вказувати на повний слаг,
  // інакше в індексі два дублікати однієї сторінки
  const canonicalOf = (html) => /<link rel="canonical" href="([^"]*)"/.exec(html)[1];
  assert.equal(
    canonicalOf(cars),
    'https://autoshopmarket.com.ua/catalog/volkswagen/volkswagen-passat-b5-1997-2005/килимки'
  );

  // модель, що дорівнює марці (/catalog/acura/acura) — це та сама марка
  assert.equal(
    canonicalOf(catalogPage(shell, { mark: 'Acura', model: 'Acura', category: '', sub: '' })),
    'https://autoshopmarket.com.ua/catalog/acura'
  );

  // пропущений сегмент не має з'їдати позицію наступного
  assert.equal(catalogHref(['volkswagen', '', 'kylymky']), '/catalog/volkswagen/usi/kylymky');
  assert.equal(catalogHref(['volkswagen', 'golf-7', '']), '/catalog/volkswagen/golf-7');
  assert.equal(catalogHref(['', '', '']), '/catalog');

  // ── неіснуючі сегменти → null (обробник віддасть 404) ──
  assert.equal(await resolveCatalog(['neisnuyucha-marka-999']), null, 'вигадана марка стала сторінкою');
  assert.equal(
    await resolveCatalog(['volkswagen', 'neisnuyucha-model-999']), null,
    'вигадана модель стала сторінкою'
  );
  assert.equal(
    await resolveCatalog(['volkswagen', 'volkswagen-passat-b5-1997-2005', 'neisnuyucha-kategoriya']), null,
    'вигадана категорія стала сторінкою'
  );
  // а справжні — резолвяться, і коротка форма теж
  assert.deepEqual(await resolveCatalog(['volkswagen', 'passat-b5']), {
    mark: 'Volkswagen', model: 'Volkswagen Passat B5 1997-2005', category: '', sub: '',
  });

  console.log('ok');
}

if (process.argv[1]?.endsWith('meta.mjs')) demo();
