// Импорт товаров поставщика DD Audio (ddaudio.com.ua) в Supabase
// через их официальный API (замена старому парсингу CSV-прайсов).
//
// Запуск:
//   Сухой прогон (ничего не пишет в БД, печатает статистику и превью):
//     node scripts/ddaudio-import.mjs --dry-run
//   Боевой прогон:
//     node scripts/ddaudio-import.mjs
//   Разовая чистка старых распарсенных товаров (supplier IS NULL,
//   кроме категорий Koch Chemie) перед первым импортом:
//     node scripts/ddaudio-import.mjs --replace-parsed
//
// Переменные окружения (локально берутся из .env автоматически):
//   DDAUDIO_API_TOKEN      — токен API из кабинета DD Audio (обязателен)
//   SUPABASE_SERVICE_KEY   — service-ключ Supabase (для записи)
//   DDAUDIO_MARKUP_PERCENT — наценка в % поверх цены API (по умолчанию 0:
//                            продаём по РРЦ поставщика как есть)
//
// Что делает:
//   • тянет розничный прайс постранично (10000 записей за запрос, ~11 страниц);
//     ВАЖНО: лимит API — 1 запрос в 5 секунд, между запросами пауза 5.5 сек;
//   • группирует записи по артикулу (sku): в прайсе один и тот же товар
//     повторяется отдельной строкой для каждой совместимой модели авто —
//     все марки/модели собираются в массивы marks/models и в compatibility;
//   • price = РРЦ; если у товара действует акция (sale_price + даты) —
//     price = акционная цена, old_price = обычная (на сайте появится скидка);
//   • категории/подкатегории API (русские) → украинские названия сайта
//     по scripts/ddaudio-category-map.json (файл можно править руками);
//   • upsert в products по (supplier, supplier_sku) — повторный запуск
//     обновляет цены/наличие, дубликатов не создаёт;
//   • товары, пропавшие из API, помечает available=false (НЕ удаляет);
//   • пересобирает справочник car_models (марка → модель) для фильтра
//     «Підбір за авто» на сайте;
//   • обновляет src/catalogTree.ts (дерево категорий для меню), сохраняя
//     подмешивание категорий Dropt из scripts/dropt-category-map.json;
//   • чужие товары (supplier != 'ddaudio') не трогает; исключение —
//     флаг --replace-parsed, который удаляет СТАРЫЕ распарсенные товары DD
//     (supplier IS NULL и категория не из списка Koch Chemie).

import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── .env (локальные запуски; в CI переменные приходят из секретов) ──
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

// ─── Параметры ──────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
const REPLACE_PARSED = process.argv.includes('--replace-parsed');

const API_BASE = 'https://ddaudio.com.ua/api';
const API_TOKEN = process.env.DDAUDIO_API_TOKEN;
const SUPABASE_URL = 'https://vhvedefyixgluayqahhh.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPPLIER = 'ddaudio';

// Наценка поверх цены API, в процентах. 0 = продаём по РРЦ поставщика.
const MARKUP_PERCENT = Number(process.env.DDAUDIO_MARKUP_PERCENT || 0);
const withMarkup = (uah) => Math.round(uah * (1 + MARKUP_PERCENT / 100));

// Лимит API: не чаще 1 запроса в 5 секунд, иначе блокировка.
const REQUEST_PAUSE_MS = 5500;

if (!API_TOKEN) {
  console.error('Ошибка: не задан DDAUDIO_API_TOKEN (токен API из кабинета DD Audio).');
  process.exit(1);
}

// Категории Koch Chemie — СВОИ товары, их не трогаем никогда
// (тот же список, что в scripts/import-products.mjs)
const KEEP_CATEGORIES = [
  'Мийка авто', "Екстер'єр", "Інтер'єр", 'COLOURLOCK', 'Скло',
  'NANO-захист', 'Консерванти', 'Поліювання', 'Обладнання (хімія)',
  'Аксесуари (хімія)', 'Аромосаше', 'Набори (хімія)', 'Брендована продукція',
];

// ─── Маппинг категорий и переводов (ru из API → ua сайта) ───
const catMap = JSON.parse(
  readFileSync(join(__dirname, 'ddaudio-category-map.json'), 'utf8')
);
const unmappedCategories = new Set();
const unmappedSubcategories = new Set();

function mapCategory(ru) {
  const ua = catMap.categories[ru];
  if (!ua && ru) unmappedCategories.add(ru);
  return ua || ru || null;
}
function mapSubcategory(ru) {
  if (!ru) return null;
  const ua = catMap.subcategories[ru];
  if (!ua) unmappedSubcategories.add(ru);
  return ua || ru;
}
// Перевод значений полей (страна, материал, установка, цвет);
// незнакомое значение оставляем как есть
const tr = (v) => (v && (catMap.values[v] || v)) || null;
const trMark = (v) => (v && (catMap.marks[v] || v)) || null;

// «Citroen C-2 2003-2009 гг.» → «Citroen C-2 2003-2009»
const cleanModel = (m) =>
  (m || '').replace(/\s*(гг|г)\.?\s*$/u, '').trim() || null;

// ─── Утилиты ────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiGet(path, attempt = 1) {
  const MAX_ATTEMPTS = 4;
  try {
    const resp = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    if (!json.success) throw new Error(`success=false: ${JSON.stringify(json).slice(0, 200)}`);
    return json;
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) {
      console.error(`Ошибка запроса ${path} (попытка ${attempt}/${MAX_ATTEMPTS}): ${err.message}`);
      throw err;
    }
    const wait = 15000 * attempt; // при сбое ждём подольше, чтобы не словить блокировку
    console.warn(`  Сбой запроса ${path} (${err.message}) — повтор через ${wait / 1000} c...`);
    await sleep(wait);
    return apiGet(path, attempt + 1);
  }
}

// Действует ли акция сегодня (даты формата YYYY-MM-DD, включительно)
function saleActive(item) {
  if (!item.sale_price || !(item.sale_price > 0)) return false;
  const today = new Date().toISOString().slice(0, 10);
  if (item.sale_start_at && today < item.sale_start_at) return false;
  if (item.sale_end_at && today > item.sale_end_at) return false;
  return true;
}

// ─── 1. Тянем розничный прайс постранично ───────────────────
console.log(`Импорт DD Audio${DRY_RUN ? ' [DRY-RUN]' : ''}${MARKUP_PERCENT ? ` (наценка ${MARKUP_PERCENT}%)` : ' (цены = РРЦ поставщика)'}`);
console.log('Скачиваю розничный прайс (пауза 5.5 с между запросами)...');

// Один товар (sku) идёт в прайсе отдельной записью на каждую совместимую
// модель авто — группируем по sku, совместимость собираем в массивы.
const bySku = new Map(); // sku → { item, marks:Set, models:Set, available }
const carPairs = new Set(); // «марка|модель» для справочника car_models
let entriesFetched = 0, skipped = 0;

let offset = 0;
let totalResults = Infinity;
let pageNum = 0;

while (offset < totalResults) {
  if (pageNum > 0) await sleep(REQUEST_PAUSE_MS);
  const page = await apiGet(`/price/retail?lang=ua&offset=${offset}`);
  totalResults = page.totalResults;
  pageNum++;
  console.log(`  страница ${pageNum}: offset=${offset}, записей ${page.data.length} из ${totalResults}`);

  for (const item of page.data) {
    entriesFetched++;
    const sku = String(item.sku ?? '').trim();
    const name = (item.title || '').trim();
    const basePrice = Number(item.price);
    if (!sku || !name || !Number.isFinite(basePrice) || basePrice <= 0) { skipped++; continue; }

    const mark = trMark((item.mark || '').trim());
    const model = cleanModel(item.model);

    let g = bySku.get(sku);
    if (!g) {
      g = { item, marks: new Set(), models: new Set(), available: false };
      bySku.set(sku, g);
    }
    if (mark && mark !== 'Універсальні') {
      g.marks.add(mark);
      if (model) carPairs.add(`${mark}|${model}`);
    }
    if (model) g.models.add(model);
    if (Number(item.available_in_stock ?? item.quantity ?? 0) > 0) g.available = true;
  }

  offset += page.limit || page.data.length || 10000;
  if (!page.data.length) break; // защита от зацикливания
}

// Защита: если API отдал подозрительно мало — не трогаем базу
if (entriesFetched < totalResults * 0.9) {
  console.error(`Ошибка: получено только ${entriesFetched} записей из ${totalResults} — обрываю, база не тронута.`);
  process.exit(1);
}

// ─── 1б. Собираем карточки товаров из групп ─────────────────
const products = [];
const feedSkus = new Set();
let saleCount = 0, variantCount = 0;

for (const [sku, g] of bySku) {
  const item = g.item;
  const category = mapCategory((item.category || '').trim());
  if (!category) { skipped++; continue; }
  const subcategory = mapSubcategory((item.subcategory || '').trim());

  // Цена: РРЦ (+ опциональная наценка); при действующей акции — скидка
  let price = withMarkup(Number(item.price));
  let oldPrice = null;
  if (saleActive(item)) {
    const salePrice = withMarkup(Number(item.sale_price));
    if (salePrice < price) {
      oldPrice = price;
      price = salePrice;
      saleCount++;
    }
  }

  const marks = [...g.marks].sort((a, b) => a.localeCompare(b, 'uk'));
  const models = [...g.models].sort((a, b) => a.localeCompare(b, 'uk'));
  const compatibility = models.length
    ? models.join(', ')
    : (marks.length ? marks.join(', ') : null);

  // Характеристики → в описание (страна/материал/установка/комплект)
  const descLines = [];
  if (item.country) descLines.push(`Країна виробництва: ${tr(item.country)}`);
  if (item.material) descLines.push(`Матеріал: ${tr(item.material)}`);
  if (item.installation) descLines.push(`Встановлення: ${tr(item.installation)}`);
  if (item.kit) descLines.push(`Комплектація: ${item.kit}`);
  if (compatibility) descLines.push(`Сумісність: ${compatibility}`);

  const parentId = item.parent?.id != null ? String(item.parent.id) : null;
  if (parentId) variantCount++;

  feedSkus.add(sku);
  products.push({
    name: (item.title || '').trim(),
    category,
    subcategory,
    price,
    old_price: oldPrice,
    images: Array.isArray(item.images) ? item.images.slice(0, 10) : [],
    brand: (item.manufacturer || '').trim() || null,
    description: descLines.join('\n') || null,
    condition: 'Новий',
    color: tr((item.color || '').trim() || null),
    compatibility,
    supplier: SUPPLIER,
    supplier_sku: sku,
    available: g.available,
    marks: marks.length ? marks : null,
    models: models.length ? models : null,
    parent_id: parentId,
    short_title: (item.short_title || '').trim() || null,
  });
}

// ─── 2. Статистика ──────────────────────────────────────────
const stats = {};
let inStock = 0;
for (const p of products) {
  const key = p.subcategory ? `${p.category} → ${p.subcategory}` : p.category;
  stats[key] = (stats[key] || 0) + 1;
  if (p.available) inStock++;
}

// Справочник «марка → модели» для подбора по авто (из пар, собранных при чтении)
const carModels = [];
const carMarks = new Set();
for (const pair of carPairs) {
  const i = pair.indexOf('|');
  const mark = pair.slice(0, i);
  const model = pair.slice(i + 1);
  carMarks.add(mark);
  carModels.push({ mark, model });
}

console.log(`\nЗаписей в прайсе: ${entriesFetched}, карточек после группировки по артикулу: ${products.length}`);
console.log(`В наличии: ${inStock}, со скидкой: ${saleCount}, вариантов: ${variantCount}, пропущено битых: ${skipped}`);
console.log(`Марок авто: ${carMarks.size}, пар марка+модель: ${carModels.length}`);

if (unmappedCategories.size) {
  console.warn(`\n⚠ Категории без перевода (добавьте в ddaudio-category-map.json):`);
  for (const c of unmappedCategories) console.warn(`  - ${c}`);
}
if (unmappedSubcategories.size) {
  console.warn(`\n⚠ Подкатегории без перевода (добавьте в ddaudio-category-map.json):`);
  for (const c of unmappedSubcategories) console.warn(`  - ${c}`);
}

console.log('\nРаспределение по категориям сайта:');
const catTotals = {};
for (const p of products) catTotals[p.category] = (catTotals[p.category] || 0) + 1;
for (const k of Object.keys(catTotals).sort((a, b) => a.localeCompare(b, 'uk'))) {
  console.log(`  ■ ${k}  (${catTotals[k]})`);
}

writeFileSync(join(ROOT, 'ddaudio-import-preview.json'), JSON.stringify({
  total: products.length,
  inStock,
  saleCount,
  variantCount,
  markupPercent: MARKUP_PERCENT,
  marks: carMarks.size,
  markModelPairs: carModels.length,
  unmappedCategories: [...unmappedCategories],
  unmappedSubcategories: [...unmappedSubcategories],
  stats,
  sample: products.slice(0, 10),
  saleSample: products.filter((p) => p.old_price).slice(0, 5),
}, null, 2), 'utf8');
console.log('\nПревью записано в ddaudio-import-preview.json');

// ─── 3. Дерево категорий для меню сайта (src/catalogTree.ts) ─
// Собираем из импортируемых товаров + подмешиваем категории Dropt
// (как это делал scripts/import-products.mjs)
const catalogTree = {};
for (const p of products) {
  catalogTree[p.category] ??= new Set();
  if (p.subcategory) catalogTree[p.category].add(p.subcategory);
}
const treeOut = {};
for (const cat of Object.keys(catalogTree).sort((a, b) => a.localeCompare(b, 'uk'))) {
  treeOut[cat] = [...catalogTree[cat]].sort((a, b) => a.localeCompare(b, 'uk'));
}
try {
  const droptMap = JSON.parse(readFileSync(join(__dirname, 'dropt-category-map.json'), 'utf8'));
  for (const [key, m] of Object.entries(droptMap)) {
    if (key.startsWith('_') || !m.category) continue;
    treeOut[m.category] ??= [];
    if (m.subcategory && !treeOut[m.category].includes(m.subcategory)) {
      treeOut[m.category].push(m.subcategory);
      treeOut[m.category].sort((a, b) => a.localeCompare(b, 'uk'));
    }
  }
} catch { /* карты Dropt нет — пропускаем */ }

const treeTs =
  `// АВТОГЕНЕРАЦИЯ скриптом scripts/ddaudio-import.mjs — не редактировать вручную.\n` +
  `export const catalogTree: Record<string, string[]> = ${JSON.stringify(treeOut, null, 2)};\n`;
const treePath = join(ROOT, 'src', 'catalogTree.ts');
const treeChanged = !existsSync(treePath) || readFileSync(treePath, 'utf8') !== treeTs;
if (DRY_RUN) {
  console.log(`\n[DRY-RUN] src/catalogTree.ts ${treeChanged ? 'ИЗМЕНИЛСЯ бы' : 'без изменений'} (${Object.keys(treeOut).length} категорий).`);
} else if (treeChanged) {
  writeFileSync(treePath, treeTs, 'utf8');
  console.log(`\nДерево категорий обновлено: src/catalogTree.ts (${Object.keys(treeOut).length} категорий).`);
} else {
  console.log('\nДерево категорий не изменилось.');
}

if (DRY_RUN) {
  // Показываем и план чистки, если попросили
  if (REPLACE_PARSED && SERVICE_KEY) {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { count, error } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .is('supplier', null)
      .not('category', 'in', `(${KEEP_CATEGORIES.map((c) => `"${c}"`).join(',')})`);
    if (error) console.error('Не удалось посчитать старые товары:', error.message);
    else console.log(`\n[DRY-RUN] --replace-parsed удалил бы ${count} старых распарсенных товаров (supplier IS NULL, кроме Koch Chemie).`);
  }
  console.log('\n[DRY-RUN] База данных не изменялась.');
  process.exit(0);
}

// ─── 4. Запись в Supabase ───────────────────────────────────
if (!SERVICE_KEY) {
  console.error('\nОшибка: не задан SUPABASE_SERVICE_KEY. Запись отменена.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// 4a. Разовая чистка старых распарсенных товаров DD (--replace-parsed).
// Удаляем ТОЛЬКО supplier IS NULL и категорию не из списка Koch Chemie.
// Товары 'dropt' и 'ddaudio' под фильтр не попадают (supplier не NULL).
if (REPLACE_PARSED) {
  const notKeep = `(${KEEP_CATEGORIES.map((c) => `"${c}"`).join(',')})`;
  const { count, error: cntErr } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .is('supplier', null)
    .not('category', 'in', notKeep);
  if (cntErr) { console.error('Ошибка подсчёта старых товаров:', cntErr.message); process.exit(1); }
  console.log(`\n--replace-parsed: удаляю ${count} старых распарсенных товаров (supplier IS NULL, кроме Koch Chemie)...`);

  // Удаляем порциями по id — одна гигантская DELETE может упереться в таймаут
  let deleted = 0;
  for (;;) {
    const { data: rows, error: selErr } = await supabase
      .from('products')
      .select('id')
      .is('supplier', null)
      .not('category', 'in', notKeep)
      .limit(1000);
    if (selErr) { console.error('Ошибка выборки на удаление:', selErr.message); process.exit(1); }
    if (!rows.length) break;
    for (let i = 0; i < rows.length; i += 500) {
      const ids = rows.slice(i, i + 500).map((r) => r.id);
      const { error: delErr } = await supabase.from('products').delete().in('id', ids);
      if (delErr) { console.error('Ошибка удаления:', delErr.message); process.exit(1); }
      deleted += ids.length;
    }
    console.log(`  удалено ${deleted} / ${count}`);
  }
  console.log(`Чистка завершена: удалено ${deleted} товаров.`);
}

// 4b. Заливаем товары (upsert по supplier+supplier_sku)
console.log(`\nЗаливаю ${products.length} товаров (upsert)...`);
const CHUNK = 500;
for (let i = 0; i < products.length; i += CHUNK) {
  const chunk = products.slice(i, i + CHUNK);
  const { error } = await supabase
    .from('products')
    .upsert(chunk, { onConflict: 'supplier,supplier_sku' });
  if (error) {
    console.error(`Ошибка upsert (чанк ${i}):`, error.message);
    process.exit(1);
  }
  if ((i / CHUNK) % 20 === 0 || i + CHUNK >= products.length) {
    console.log(`  ${Math.min(i + CHUNK, products.length)} / ${products.length}`);
  }
}

// 4c. Помечаем пропавшие из API товары как отсутствующие
console.log('\nПроверяю товары, пропавшие из прайса...');
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
  console.log(`Пропало из прайса: ${gone.length} — помечаю available=false`);
  for (let i = 0; i < gone.length; i += 200) {
    const { error } = await supabase
      .from('products')
      .update({ available: false })
      .eq('supplier', SUPPLIER)
      .in('supplier_sku', gone.slice(i, i + 200));
    if (error) { console.error('Ошибка пометки:', error.message); process.exit(1); }
  }
}

// 4d. Пересобираем справочник car_models для «Підбір за авто»
console.log(`\nОбновляю справочник марок/моделей (${carModels.length} записей)...`);
{
  const { error: delErr } = await supabase.from('car_models').delete().neq('mark', '');
  if (delErr) {
    // Таблицы может ещё не быть (миграция не выполнена) — не валим импорт
    console.warn('Не удалось очистить car_models (миграция ddaudio_migration.sql выполнена?):', delErr.message);
  } else {
    for (let i = 0; i < carModels.length; i += 1000) {
      const { error } = await supabase
        .from('car_models')
        .upsert(carModels.slice(i, i + 1000), { onConflict: 'mark,model' });
      if (error) { console.error('Ошибка заливки car_models:', error.message); process.exit(1); }
    }
    console.log('Справочник car_models обновлён.');
  }
}

console.log('\nГотово! Импорт DD Audio завершён.');
