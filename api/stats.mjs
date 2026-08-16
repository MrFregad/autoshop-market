// GET/POST /admin/stats — звіт за пошуковими запитами за 30 днів.
//
// Дві таблиці: що шукали і чого НЕ знайшли. Друга — головна: це список
// того, чого бракує в каталозі, зібраний руками самих покупців.
//
// Чому не Vercel Analytics: у нього немає API, щоб прочитати свої ж події
// назад — вони живуть тільки в його дашборді. Тому запити дублюються в
// таблицю search_log (supabase/search_log.sql), і звіт будується з неї.
//
// Пароль перевіряється ТІЛЬКИ тут, на сервері, і приймається лише POST-ом:
// у GET-параметрі він осів би в логах Vercel і в історії браузера.
// Файл самодостатній (без локальних імпортів) — вимога Vercel.

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'AS-market#2026_x7Kq';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vhvedefyixgluayqahhh.supabase.co';
// Журнал закритий RLS на читання — потрібен service-ключ
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const DAYS = 30;
const TOP = 50;
const MAX_ROWS = 100000;

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Групує рядки журналу за запитом. Чиста функція — її перевіряє demo(). */
export function summarize(rows) {
  const all = new Map();
  const empty = new Map();
  for (const r of rows) {
    const q = String(r.query ?? '').trim().toLowerCase();
    if (!q) continue;
    all.set(q, (all.get(q) || 0) + 1);
    if (Number(r.results) === 0) empty.set(q, (empty.get(q) || 0) + 1);
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP);
  return {
    total: rows.length,
    emptyTotal: rows.filter((r) => Number(r.results) === 0).length,
    top: top(all),
    topEmpty: top(empty),
  };
}

const page = (inner) => `<!doctype html>
<html lang="uk"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Пошукові запити · AutoShop</title>
<style>
  body{font:15px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1e1b2e;background:#f4f4f6;margin:0;padding:24px}
  .wrap{max-width:900px;margin:0 auto}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:28px 0 8px}
  .muted{color:#52525b;font-size:13px;margin:0 0 20px}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  th,td{padding:9px 12px;text-align:left;border-bottom:1px solid #eee;font-size:14px}
  th{background:#faf7ff;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#4b3f6b}
  td:last-child,th:last-child{text-align:right;width:90px}
  tr:last-child td{border-bottom:none}
  .empty td:first-child{font-weight:600}
  .box{background:#fff;border-radius:12px;padding:20px;max-width:360px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  input,button{font:inherit;width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #d4d4d8}
  button{margin-top:10px;background:#6d28d9;color:#fff;border:0;font-weight:700;cursor:pointer}
  .err{color:#b91c1c;font-size:13px;margin:8px 0 0}
  .note{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px;font-size:13px;margin:16px 0}
</style></head><body><div class="wrap">${inner}</div></body></html>`;

const loginForm = (error) => page(`
  <h1>Пошукові запити</h1>
  <p class="muted">Звіт закритий паролем адміністратора.</p>
  <form method="post" class="box">
    <input type="password" name="password" placeholder="Пароль" autofocus autocomplete="current-password" />
    <button type="submit">Увійти</button>
    ${error ? `<p class="err">${esc(error)}</p>` : ''}
  </form>`);

const table = (rows, head) =>
  rows.length
    ? `<table><thead><tr><th>${head}</th><th>Разів</th></tr></thead><tbody>` +
      rows.map(([q, n]) => `<tr><td>${esc(q)}</td><td>${n}</td></tr>`).join('') +
      '</tbody></table>'
    : '<p class="muted">Поки порожньо.</p>';

const report = (s) => page(`
  <h1>Пошукові запити за ${DAYS} днів</h1>
  <p class="muted">Усього пошуків: <b>${s.total}</b> · без результату: <b>${s.emptyTotal}</b>
    ${s.total ? `(${Math.round((s.emptyTotal / s.total) * 100)}%)` : ''}</p>

  <h2>Нічого не знайшли — топ-${TOP}</h2>
  <p class="muted">Це список того, чого бракує в каталозі. Найцінніша таблиця на сторінці.</p>
  ${table(s.topEmpty, 'Запит')}

  <h2>Найчастіші запити — топ-${TOP}</h2>
  ${table(s.top, 'Запит')}`);

async function loadRows() {
  const since = new Date(Date.now() - DAYS * 86400000).toISOString();
  const url =
    `${SUPABASE_URL}/rest/v1/search_log?select=query,results` +
    `&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=${MAX_ROWS}`;
  const r = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) throw new Error(`supabase ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'POST') return res.status(200).send(loginForm(null));

  // Vercel парсить form-urlencoded сам, але підстрахуємось на випадок рядка
  let password = req.body?.password;
  if (typeof password !== 'string' && typeof req.body === 'string') {
    password = new URLSearchParams(req.body).get('password');
  }
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).send(loginForm('Невірний пароль.'));
  }
  if (!SUPABASE_SERVICE_READY()) {
    return res.status(200).send(
      page(`<h1>Пошукові запити</h1><div class="note">Не задано <b>SUPABASE_SERVICE_KEY</b> —
        журнал закритий RLS і без цього ключа не читається.
        Додайте змінну в налаштуваннях Vercel і оновіть сторінку.</div>`)
    );
  }

  try {
    return res.status(200).send(report(summarize(await loadRows())));
  } catch (err) {
    // PostgREST на відсутню таблицю віддає PGRST205, а не 42P01
    const hint = /42P01|PGRST205|does not exist|Could not find the table/.test(err.message)
      ? 'Схоже, не виконано <b>supabase/search_log.sql</b> — таблиці журналу ще немає.'
      : esc(err.message);
    return res.status(200).send(page(`<h1>Пошукові запити</h1><div class="note">${hint}</div>`));
  }
}

const SUPABASE_SERVICE_READY = () => Boolean(SUPABASE_KEY);

// ─── Самоперевірка: node api/stats.mjs ──────────────────────
async function demo() {
  const { default: assert } = await import('node:assert/strict');

  const s = summarize([
    { query: 'Килимки', results: 12 },
    { query: 'килимки ', results: 12 },
    { query: 'шноркель', results: 0 },
    { query: 'шноркель', results: 0 },
    { query: 'шноркель', results: 0 },
    { query: 'дефлектори', results: 3 },
    { query: '   ', results: 0 },
  ]);

  assert.equal(s.total, 7);
  assert.equal(s.emptyTotal, 4, 'порожні рахуються по results === 0');
  // регістр і пробіли не мають плодити різні рядки у звіті
  assert.deepEqual(s.top[0], ['шноркель', 3]);
  assert.deepEqual(s.top[1], ['килимки', 2], 'Килимки й «килимки » — один запит');
  // порожній запит у звіт не потрапляє
  assert.ok(!s.top.some(([q]) => !q.trim()));
  // головна таблиця — лише те, що нічого не знайшло
  assert.deepEqual(s.topEmpty, [['шноркель', 3]]);

  // порожній журнал не ламає звіт
  const zero = summarize([]);
  assert.deepEqual(zero.topEmpty, []);
  assert.match(report(zero), /Усього пошуків: <b>0<\/b>/);

  // екранування: запит із розміткою не має ставати HTML
  assert.match(report(summarize([{ query: '<img src=x onerror=alert(1)>', results: 0 }])), /&lt;img src=x/);
  assert.ok(!report(summarize([{ query: '<script>', results: 0 }])).includes('<script>'));

  console.log('ok');
}

if (process.argv[1]?.endsWith('stats.mjs')) demo();
