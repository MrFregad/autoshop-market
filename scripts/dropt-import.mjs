// Импорт товаров поставщика Dropt (dropt.in.ua) в Supabase.
//
// Источник — персональный XML-фид (формат Prom/YML) с наценкой 0%,
// то есть в фиде дроп-цены; розничную цену считает этот скрипт.
//
// Запуск:
//   Сухой прогон (ничего не пишет в БД, печатает статистику и превью):
//     DROPT_FEED_URL="https://dropt.in.ua/index.php?route=export/prom&markup=0&category=59&ids=uniq" \
//       node scripts/dropt-import.mjs --dry-run
//   Боевой прогон:
//     DROPT_FEED_URL="..." SUPABASE_SERVICE_KEY="..." node scripts/dropt-import.mjs
//
// Что делает:
//   • скачивает фид, разбирает офферы (название, цена, фото, описание,
//     бренд, артикул vendorCode, наличие);
//   • цена продажи = дроп-цена + 50%, но наценка не больше 1000 грн
//     (то же правило, что и в scripts/import-products.mjs);
//   • категории Dropt → категории сайта по scripts/dropt-category-map.json
//     (файл можно править руками);
//   • upsert в products по (supplier, supplier_sku) — повторный запуск
//     обновляет цены/наличие, дубликатов не создаёт;
//   • товары, пропавшие из фида, помечает available=false (НЕ удаляет);
//   • чужие товары (supplier != 'dropt') не трогает вообще.

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Параметры ──────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
const FEED_URL = process.env.DROPT_FEED_URL;
const SUPABASE_URL = 'https://vhvedefyixgluayqahhh.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPPLIER = 'dropt';

// Правило цены: дроп-цена +50%, но наценка не больше 1000 грн (как на сайте)
const MARKUP_CAP_UAH = 1000;
function priceFor(baseUAH) {
  const markup = Math.min(baseUAH * 0.5, MARKUP_CAP_UAH);
  return Math.round(baseUAH + markup);
}

if (!FEED_URL) {
  console.error('Ошибка: не задан DROPT_FEED_URL (персональная ссылка на XML-фид из кабинета Dropt).');
  process.exit(1);
}

// ─── Маппинг категорий ──────────────────────────────────────
const categoryMap = JSON.parse(
  readFileSync(join(__dirname, 'dropt-category-map.json'), 'utf8')
);
function mapCategory(droptCategoryId) {
  const m = categoryMap[String(droptCategoryId)] || categoryMap._default;
  return { category: m.category, subcategory: m.subcategory || null };
}

// ─── Утилиты разбора XML ────────────────────────────────────
// Фид простой и предсказуемый, поэтому обходимся без XML-библиотек.
function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// Одиночный тег: <price>123</price> (поддерживает CDATA)
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`));
  return m ? m[1].trim() : '';
}

// Описание из фида приходит с HTML — превращаем в читаемый текст
function htmlToText(html, maxLen = 1500) {
  let t = html
    .replace(/<img[^>]*>/gi, ' ')                 // картинки убираем
    .replace(/<(br|\/p|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n') // переносы строк
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ');                    // остальные теги — прочь
  t = decodeEntities(t)
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (t.length > maxLen) {
    t = t.slice(0, maxLen);
    const cut = t.lastIndexOf(' ');
    if (cut > maxLen * 0.8) t = t.slice(0, cut);
    t += '…';
  }
  return t;
}

// ─── 1. Скачиваем фид ───────────────────────────────────────
console.log('Скачиваю фид Dropt...');
const resp = await fetch(FEED_URL);
if (!resp.ok) {
  console.error(`Ошибка скачивания фида: HTTP ${resp.status}`);
  process.exit(1);
}
const xml = await resp.text();
console.log(`Фид получен: ${(xml.length / 1024 / 1024).toFixed(1)} МБ`);

// ─── 2. Разбираем офферы ────────────────────────────────────
const offerBlocks = xml.match(/<offer [\s\S]*?<\/offer>/g) || [];
console.log(`Офферов в фиде: ${offerBlocks.length}`);

const products = [];
const feedSkus = new Set();
let skipped = 0;

for (const block of offerBlocks) {
  const attrs = block.match(/<offer ([^>]*)>/)[1];
  const available = /available="true"/.test(attrs);

  const sku = tag(block, 'vendorCode');
  const name = decodeEntities(tag(block, 'name_ua') || tag(block, 'name'));
  const price = parseFloat(tag(block, 'price'));
  const categoryId = tag(block, 'categoryId');
  const vendor = decodeEntities(tag(block, 'vendor'));
  const url = tag(block, 'url');
  const descriptionHtml = tag(block, 'description_ua') || tag(block, 'description');
  const images = [...block.matchAll(/<picture>([^<]+)<\/picture>/g)]
    .map((m) => m[1].trim())
    .slice(0, 10);

  if (!sku || !name || !Number.isFinite(price) || price <= 0) { skipped++; continue; }
  if (feedSkus.has(sku)) { skipped++; continue; } // защита от дублей внутри фида
  feedSkus.add(sku);

  const { category, subcategory } = mapCategory(categoryId);

  products.push({
    name,
    category,
    subcategory,
    price: priceFor(price),
    images,
    brand: vendor || null,
    description: descriptionHtml ? htmlToText(descriptionHtml) : null,
    condition: 'Новий',
    supplier: SUPPLIER,
    supplier_sku: sku,
    supplier_url: url || null,
    available,
  });
}

// ─── 3. Статистика ──────────────────────────────────────────
const stats = {};
let inStock = 0;
for (const p of products) {
  const key = p.subcategory ? `${p.category} → ${p.subcategory}` : p.category;
  stats[key] = (stats[key] || 0) + 1;
  if (p.available) inStock++;
}
console.log(`\nТоваров к импорту: ${products.length} (в наличии: ${inStock}, пропущено битых/дублей: ${skipped})`);
console.log('\nРаспределение по категориям сайта:');
for (const k of Object.keys(stats).sort((a, b) => a.localeCompare(b, 'uk'))) {
  console.log(`  ■ ${k}  (${stats[k]})`);
}

writeFileSync(join(__dirname, '..', 'dropt-import-preview.json'), JSON.stringify({
  total: products.length,
  inStock,
  stats,
  sample: products.slice(0, 10),
}, null, 2), 'utf8');
console.log('\nПревью записано в dropt-import-preview.json');

if (DRY_RUN) {
  console.log('\n[DRY-RUN] База данных не изменялась.');
  process.exit(0);
}

// ─── 4. Запись в Supabase ───────────────────────────────────
if (!SERVICE_KEY) {
  console.error('\nОшибка: не задан SUPABASE_SERVICE_KEY. Запись отменена.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// upsert пачками: конфликт по (supplier, supplier_sku) → обновление записи
console.log(`\nЗаливаю ${products.length} товаров (upsert)...`);
const CHUNK = 200;
for (let i = 0; i < products.length; i += CHUNK) {
  const chunk = products.slice(i, i + CHUNK);
  const { error } = await supabase
    .from('products')
    .upsert(chunk, { onConflict: 'supplier,supplier_sku' });
  if (error) {
    console.error(`Ошибка upsert (чанк ${i}):`, error.message);
    process.exit(1);
  }
  console.log(`  ${Math.min(i + CHUNK, products.length)} / ${products.length}`);
}

// ─── 5. Помечаем пропавшие из фида как отсутствующие ────────
console.log('\nПроверяю товары, пропавшие из фида...');
const dbSkus = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('products')
    .select('supplier_sku')
    .eq('supplier', SUPPLIER)
    .range(from, from + 999);
  if (error) { console.error('Ошибка чтения:', error.message); process.exit(1); }
  dbSkus.push(...data.map((r) => r.supplier_sku));
  if (data.length < 1000) break;
}
const gone = dbSkus.filter((sku) => sku && !feedSkus.has(sku));
if (gone.length === 0) {
  console.log('Пропавших товаров нет.');
} else {
  console.log(`Пропало из фида: ${gone.length} — помечаю available=false`);
  for (let i = 0; i < gone.length; i += 200) {
    const { error } = await supabase
      .from('products')
      .update({ available: false })
      .eq('supplier', SUPPLIER)
      .in('supplier_sku', gone.slice(i, i + 200));
    if (error) { console.error('Ошибка пометки:', error.message); process.exit(1); }
  }
}

console.log('\nГотово! Импорт Dropt завершён.');
