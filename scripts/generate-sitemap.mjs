// Генерация public/sitemap.xml со всеми товарами (/product/:id).
// Запуск: npm run sitemap
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SITE = 'https://autoshop-market.vercel.app';
const supabase = createClient(
  'https://vhvedefyixgluayqahhh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZodmVkZWZ5aXhnbHVheXFhaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzE0OTEsImV4cCI6MjA5NjY0NzQ5MX0.RMK8MjUTTOO4slWV5kQw5ue7oAkUQyBFhaXhqz3FGtM'
);

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../public/sitemap.xml');
const today = new Date().toISOString().slice(0, 10);

const isPlaceholder = (name) =>
  (name || '').trim().toLowerCase().startsWith('замовити будь-який товар');

// Тянем все id пачками (Supabase отдаёт максимум 1000 строк за запрос)
const BATCH = 1000;
const rows = [];
let from = 0;
while (true) {
  const { data, error } = await supabase
    .from('products')
    .select('id,name')
    .order('id', { ascending: true })
    .range(from, from + BATCH - 1);
  if (error) { console.error('Supabase error:', error.message); process.exit(1); }
  if (!data || data.length === 0) break;
  rows.push(...data);
  if (data.length < BATCH) break;
  from += BATCH;
}

const products = rows.filter((r) => !isPlaceholder(r.name));

const urls = [
  `  <url>\n    <loc>${SITE}/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>`,
  ...products.map(
    (p) =>
      `  <url>\n    <loc>${SITE}/product/${p.id}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`
  ),
];

const xml =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.join('\n') +
  `\n</urlset>\n`;

writeFileSync(OUT, xml, 'utf8');
console.log(`Готово: ${products.length} товарів + головна → ${OUT}`);
