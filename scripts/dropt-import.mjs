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
//   • цена продажи = дроп-цена × тир (src/lib/pricing.js), сама дроп-цена
//     сохраняется в products.cost_price; товары с price_manual = true
//     сохраняют свою цену
//     (то же правило, что и в scripts/import-products.mjs);
//   • категории Dropt → категории сайта по scripts/dropt-category-map.json
//     (файл можно править руками);
//   • upsert в products по (supplier, supplier_sku) — повторный запуск
//     обновляет цены/наличие, дубликатов не создаёт;
//   • товары, пропавшие из фида, помечает available=false (НЕ удаляет);
//   • чужие товары (supplier != 'dropt') не трогает вообще.

import { createClient } from '@supabase/supabase-js';
import { calculatePrice } from '../src/lib/pricing.js';
import { fetchSupplierSkus } from './supplier-skus.mjs';
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

// Цена продажи считается от дроп-цены по тирам из src/lib/pricing.js —
// та же формула, что и у DD Audio. Дроп-цена пишется в products.cost_price.

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
const tierCount = {};
const marketCheck = [];

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

  const calc = calculatePrice(price);
  tierCount[calc.tierIndex] = (tierCount[calc.tierIndex] || 0) + 1;
  if (calc.needsMarketCheck) marketCheck.push({ sku, name, cost: price, price: calc.price });

  products.push({
    name,
    category,
    subcategory,
    price: calc.price,
    old_price: calc.oldPrice,
    cost_price: price,
    price_updated_at: new Date().toISOString(),
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
const tiers = Object.keys(tierCount).sort((a, b) => a - b)
  .map((i) => `тир ${Number(i) + 1}: ${tierCount[i]}`).join(', ');
console.log(`Цены посчитаны от дроп-цены — ${tiers}`);
if (marketCheck.length) {
  console.log(`⚠ ${marketCheck.length} товаров с закупкой от 5000 грн — цену стоит сверить с конкурентами`);
  for (const m of marketCheck.slice(0, 10)) {
    console.log(`   ${m.sku}  закупка ${m.cost} → ${m.price} грн  ${m.name.slice(0, 50)}`);
  }
}
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

// Колонки ценообразования могли ещё не появиться (supabase/pricing_migration.sql) —
// тогда заливаем без них, чтобы ночной импорт не падал на пустом месте.
const { error: costProbe } = await supabase.from('products').select('cost_price').limit(1);
const hasPricingColumns = !costProbe;
if (!hasPricingColumns) {
  console.warn('Колонок cost_price/price_manual нет — новое ценообразование ВЫКЛЮЧЕНО, цены на сайте остаются прежними.');
  console.warn('Чтобы включить, выполните supabase/pricing_migration.sql. Ответ базы:', costProbe.message);
}
// Пока миграции нет — цены вообще не трогаем (обновляем только наличие,
// фото и тексты). Выполнить SQL = включить новое ценообразование.
const stripPricing = (rows) => hasPricingColumns
  ? rows
  : rows.map(({ cost_price, price_updated_at, price, old_price, ...rest }) => rest);

// Товары с ручной ценой (price_manual) — цену не перезаписываем
let manualSkus = new Set();
if (hasPricingColumns) {
  const { skus, error } = await fetchSupplierSkus(supabase, SUPPLIER, { manualOnly: true });
  // Колонка есть (проверена выше), значит ошибка — это сбой запроса.
  // Продолжить = затереть цены, выставленные руками, поэтому обрываем импорт.
  if (error) {
    console.error('Не удалось прочитать товары с ручной ценой:', error.message);
    console.error('Если это statement timeout — выполните supabase/pricing_migration.sql (индекс products_price_manual_idx).');
    process.exit(1);
  }
  manualSkus = new Set(skus);
}

// upsert пачками: конфликт по (supplier, supplier_sku) → обновление записи
async function upsertRows(rows, label) {
  if (!rows.length) return;
  console.log(`
Заливаю ${rows.length} товаров (${label})...`);
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase
      .from('products')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'supplier,supplier_sku' });
    if (error) {
      console.error(`Ошибка upsert (чанк ${i}):`, error.message);
      process.exit(1);
    }
    console.log(`  ${Math.min(i + CHUNK, rows.length)} / ${rows.length}`);
  }
}

await upsertRows(stripPricing(products.filter((p) => !manualSkus.has(p.supplier_sku))), 'цена по формуле');
await upsertRows(
  stripPricing(products
    .filter((p) => manualSkus.has(p.supplier_sku))
    .map(({ price, old_price, price_updated_at, ...rest }) => rest)),
  'ручная цена сохраняется',
);

// ─── 5. Помечаем пропавшие из фида как отсутствующие ────────
console.log('\nПроверяю товары, пропавшие из фида...');
const { skus: dbSkus, error: readErr } = await fetchSupplierSkus(supabase, SUPPLIER);
if (readErr) { console.error('Ошибка чтения:', readErr.message); process.exit(1); }
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
