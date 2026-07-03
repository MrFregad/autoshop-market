// Генерация товарного фида для Facebook / Instagram Shopping.
//
// Facebook сам скачивает этот файл по расписанию и обновляет каталог товаров,
// который потом используется в рекламе и в магазине на странице.
// Формат — RSS 2.0 с namespace g: (официальный формат Facebook Product Feed).
//
// Файл кладётся в public/facebook-catalog.xml и отдаётся Vercel по адресу:
//   https://autoshop-market.vercel.app/facebook-catalog.xml
// Этот URL вставляется в Commerce Manager → Каталог → Источники данных →
// Запланированный фид (обновление раз в сутки).
//
// Запуск: npm run fb:catalog

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SITE = 'https://autoshop-market.vercel.app';
const CURRENCY = 'UAH';

const supabase = createClient(
  'https://vhvedefyixgluayqahhh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZodmVkZWZ5aXhnbHVheXFhaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzE0OTEsImV4cCI6MjA5NjY0NzQ5MX0.RMK8MjUTTOO4slWV5kQw5ue7oAkUQyBFhaXhqz3FGtM'
);

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '../public');

// Экранирование спецсимволов XML
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

// Facebook: title ≤ 150 симв., description ≤ 9999 симв.
const clip = (s, n) => {
  const t = String(s ?? '').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};

// condition в БД по-украински → значения, которые понимает Facebook
const mapCondition = (c) => {
  const v = (c || '').toLowerCase();
  if (v.startsWith('нов')) return 'new';
  if (v.startsWith('б') || v.includes('вжив')) return 'used';
  return 'new';
};

// Тянем все товары пачками (Supabase отдаёт максимум 1000 строк за запрос)
const BATCH = 1000;
const rows = [];
let from = 0;
while (true) {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,category,subcategory,price,images,brand,condition,description')
    .gt('price', 1) // отсекаем плейсхолдеры "Замовити будь-який товар" (price = 1)
    .order('id', { ascending: true })
    .range(from, from + BATCH - 1);
  if (error) {
    console.error('Supabase error:', error.message);
    process.exit(1);
  }
  if (!data || data.length === 0) break;
  rows.push(...data);
  if (data.length < BATCH) break;
  from += BATCH;
}

let skipped = 0;
const items = [];
for (const p of rows) {
  const image = Array.isArray(p.images) ? p.images[0] : null;
  // Facebook требует картинку и цену — товары без них пропускаем
  if (!image || !(p.price > 0)) {
    skipped++;
    continue;
  }

  const title = clip(p.name, 150);
  const descr =
    clip(
      p.description ||
        [p.name, p.category, p.subcategory].filter(Boolean).join('. '),
      9999
    ) || title;
  const brand = clip(p.brand || p.category || 'AutoShop', 100);

  items.push(
    '    <item>\n' +
      `      <g:id>${p.id}</g:id>\n` +
      `      <g:title>${esc(title)}</g:title>\n` +
      `      <g:description>${esc(descr)}</g:description>\n` +
      `      <g:link>${SITE}/product/${p.id}</g:link>\n` +
      `      <g:image_link>${esc(image)}</g:image_link>\n` +
      `      <g:availability>in stock</g:availability>\n` +
      `      <g:condition>${mapCondition(p.condition)}</g:condition>\n` +
      `      <g:price>${Number(p.price).toFixed(2)} ${CURRENCY}</g:price>\n` +
      `      <g:brand>${esc(brand)}</g:brand>\n` +
      (p.category
        ? `      <g:product_type>${esc(
            [p.category, p.subcategory].filter(Boolean).join(' > ')
          )}</g:product_type>\n`
        : '') +
      '    </item>'
  );
}

const xml =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n` +
  `  <channel>\n` +
  `    <title>AutoShop Market — каталог товарів</title>\n` +
  `    <link>${SITE}</link>\n` +
  `    <description>Автотовари та аксесуари. Доставка по всій Україні.</description>\n` +
  items.join('\n') +
  `\n  </channel>\n` +
  `</rss>\n`;

writeFileSync(resolve(PUBLIC_DIR, 'facebook-catalog.xml'), xml, 'utf8');

console.log(
  `Готово: ${items.length} товарів у фіді (пропущено без фото/ціни: ${skipped}) → ${resolve(
    PUBLIC_DIR,
    'facebook-catalog.xml'
  )}`
);
