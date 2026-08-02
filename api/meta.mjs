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

  if (body) html = html.replace('<div id="root"></div>', `<div id="root">${body}</div>`);

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

export function categoryPage(shell, cat, sub) {
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
        `<p style="margin:0;color:#4b5563">${esc(description)}</p>`
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
  const { type, id, cat, sub } = req.query ?? {};
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
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).send(categoryPage(shell, decodeURIComponent(cat ?? ''), sub && decodeURIComponent(sub)));
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

  const catHtml = categoryPage(shell, "Інтер'єр", null);
  assert.match(catHtml, /<link rel="canonical" href="[^"]*\/category\/%D0%86/);
  assert.match(catHtml, /"@type":"CollectionPage"/);

  console.log('ok');
}

if (process.argv[1]?.endsWith('meta.mjs')) demo();
