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

const SITE = 'https://autoshop-market.vercel.app';
const SUPABASE_URL = 'https://vhvedefyixgluayqahhh.supabase.co';
const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZodmVkZWZ5aXhnbHVheXFhaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzE0OTEsImV4cCI6MjA5NjY0NzQ5MX0.RMK8MjUTTOO4slWV5kQw5ue7oAkUQyBFhaXhqz3FGtM';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Опис у БД може містити HTML — для <meta> потрібен чистий текст
const plain = (s, n = 300) => {
  const t = String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};

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

async function fetchProduct(id) {
  const fields = 'id,name,category,subcategory,price,images,brand,condition,description';
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/products?id=eq.${encodeURIComponent(id)}&select=${fields}&limit=1`,
    { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
  );
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  const [p] = await r.json();
  return p ?? null;
}

function productPage(shell, p) {
  const canonical = `${SITE}/product/${p.id}`;
  const image = Array.isArray(p.images) ? p.images[0] : null;
  const title = `${p.name} — купити в Україні | AutoShop Market`.slice(0, 120);
  const description =
    plain(p.description, 200) ||
    `${p.name}${p.brand ? ` (${p.brand})` : ''} — ціна ${p.price} грн. Доставка по Україні Новою Поштою.`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    sku: String(p.id),
    url: canonical,
    ...(image ? { image } : {}),
    ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {}),
    ...(p.category ? { category: [p.category, p.subcategory].filter(Boolean).join(' / ') } : {}),
    description: plain(p.description, 900) || p.name,
    offers: {
      '@type': 'Offer',
      url: canonical,
      price: String(p.price),
      priceCurrency: 'UAH',
      availability: 'https://schema.org/InStock',
      itemCondition:
        (p.condition || '').toLowerCase().startsWith('б') ||
        (p.condition || '').toLowerCase().includes('вжив')
          ? 'https://schema.org/UsedCondition'
          : 'https://schema.org/NewCondition',
      seller: { '@id': `${SITE}/#organization` },
    },
  };

  // ponytail: текст у #root React затирає при монтуванні — на повільному
  // з'єднанні можливий короткий показ неоформленого блоку. Прибрати можна
  // лише переїздом на SSR/ISR; для краулерів це єдиний спосіб побачити зміст.
  const body =
    `<h1>${esc(p.name)}</h1>` +
    (p.brand ? `<p>Бренд: ${esc(p.brand)}</p>` : '') +
    `<p>Ціна: ${esc(p.price)} грн</p>` +
    (image ? `<img src="${esc(image)}" alt="${esc(p.name)}" width="600" />` : '') +
    `<p>${esc(plain(p.description, 1200))}</p>`;

  return injectMeta(shell, { title, description, canonical, image, jsonLd, body });
}

function categoryPage(shell, cat, sub) {
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
    body: `<h1>${esc(name)}</h1><p>${esc(description)}</p>`,
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

  const html = productPage(shell, {
    id: 271389,
    name: 'Дефлектор "Х" & <тест>',
    category: 'Дефлектори',
    subcategory: null,
    price: 450,
    images: ['https://cdn.example/a.jpg'],
    brand: 'Heko',
    condition: 'Новий',
    description: '<p>Опис із <b>HTML</b> та лапками "тут"</p>',
  });

  assert.match(html, /<title>Дефлектор &quot;Х&quot; &amp; &lt;тест&gt; — купити/);
  assert.match(html, /<link rel="canonical" href="https:\/\/autoshop-market\.vercel\.app\/product\/271389" \/>/);
  assert.ok(!html.includes('<link rel="canonical" href="https://autoshop-market.vercel.app/" />'), 'старий canonical лишився');
  assert.match(html, /"@type":"Product"/);
  assert.match(html, /"price":"450"/);
  assert.ok(!/"description":"[^"]*<p>/.test(html), 'HTML протік у JSON-LD description');
  assert.match(html, /<div id="root"><h1>Дефлектор/);
  assert.match(html, /content="https:\/\/cdn\.example\/a\.jpg"/);

  const catHtml = categoryPage(shell, "Інтер'єр", null);
  assert.match(catHtml, /<link rel="canonical" href="[^"]*\/category\/%D0%86/);
  assert.match(catHtml, /"@type":"CollectionPage"/);

  console.log('ok');
}

if (process.argv[1]?.endsWith('meta.mjs')) demo();
