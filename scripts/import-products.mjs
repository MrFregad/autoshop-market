// Импорт товаров из CSV-прайсов (E:\dd_price_*.csv) в Supabase.
//
// Запуск:
//   Сухой прогон (без записи в БД), печатает дерево категорий и статистику:
//     node scripts/import-products.mjs --dry-run
//   Боевой прогон (удаляет всё кроме Автохімії Koch Chemie и заливает новое):
//     SUPABASE_SERVICE_KEY=... USD=42 EUR=45 node scripts/import-products.mjs
//
// Решения (согласованы с владельцем):
//  • price = Цена(из CSV) × курс_валюты × 1.5, old_price НЕ заполняем
//  • курс: USD/EUR из env (по умолчанию 42 / 45), UAH = 1
//  • строки группируются по (Категория + Артикул) → одна карточка
//    совместимые авто (Марка + Модель) собираются в compatibility
//  • импортируем всё, включая К-во = 0
//  • при заливке в БД сохраняем существующие товары Автохімії (Koch Chemie)

import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Параметры ──────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
const SRC_DIR = process.env.CSV_DIR || 'E:/';
const RATES = { USD: Number(process.env.USD || 42), EUR: Number(process.env.EUR || 45), UAH: 1 };

// Цена: базовая стоимость в гривнах +50%, но сама наценка не больше 1000 грн.
const MARKUP_CAP_UAH = 1000;
function priceFor(baseUAH) {
  const markup = Math.min(baseUAH * 0.5, MARKUP_CAP_UAH);
  return Math.round(baseUAH + markup);
}

const SUPABASE_URL = 'https://vhvedefyixgluayqahhh.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Категории Koch Chemie (Автохімія), которые НЕ трогаем в БД
const KEEP_CATEGORIES = new Set([
  'Мийка авто', "Екстер'єр", "Інтер'єр", 'COLOURLOCK', 'Скло',
  'NANO-захист', 'Консерванти', 'Поліювання', 'Обладнання (хімія)',
  'Аксесуари (хімія)', 'Аромосаше', 'Набори (хімія)', 'Брендована продукція',
]);

// Нормализация названий категорий из CSV → как на сайте
const CATEGORY_MAP = {
  'Захист дна': 'Захист днища',
  'Шумовіброізоляція автомобіля': 'Шумовіброізоляція',
};
const normCat = (c) => CATEGORY_MAP[c] || c;

// ─── Парсер CSV (разделитель ';', кавычки ") ────────────────
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ';') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch === '\r') { /* skip */ }
      else field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ─── Чтение всех прайсов ────────────────────────────────────
// В папке могут лежать и старые, и новые выгрузки одного прайса
// (dd_price_<name>_<timestamp>.csv). Берём только новейший таймстамп каждого прайса.
const allFiles = readdirSync(SRC_DIR).filter(f => /^dd_price_.*\.csv$/i.test(f));
const newest = new Map(); // base → { ts, file }
for (const f of allFiles) {
  const m = f.match(/^(dd_price_.*)_(\d+)\.csv$/i);
  const base = m ? m[1] : f;
  const ts = m ? Number(m[2]) : 0;
  const prev = newest.get(base);
  if (!prev || ts > prev.ts) newest.set(base, { ts, file: f });
}
const files = [...newest.values()].map(v => v.file);
console.log(`Файлов в папке: ${allFiles.length}, взято новейших прайсов: ${files.length}`);

const groups = new Map(); // key = категория||артикул

for (const file of files) {
  const text = readFileSync(join(SRC_DIR, file), 'utf8');
  const rows = parseCSV(text);
  if (rows.length < 2) continue;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 14 || !r[7]) continue; // нет наименования — пропуск
    const [, , artikul, kategoria, podkat, marka, model, name, proizv, kvo, , cena, , valuta, foto] = r;
    const category = normCat((kategoria || '').trim());
    if (!category) continue;
    const key = `${category}||${(artikul || name).trim()}`;
    if (!groups.has(key)) {
      groups.set(key, {
        name: name.trim(),
        category,
        subcategory: (podkat || '').trim() || null,
        brand: (proizv || '').trim() || null,
        cena: parseFloat((cena || '0').replace(',', '.')) || 0,
        valuta: (valuta || 'UAH').trim().toUpperCase(),
        images: new Set(),
        compat: new Set(),
        qty: 0,
      });
    }
    const g = groups.get(key);
    if (foto && foto.trim()) g.images.add(foto.trim());
    const mk = (marka || '').trim();
    const md = (model || '').trim();
    if (md) g.compat.add(md);
    else if (mk && mk !== 'Універсальні') g.compat.add(mk);
    g.qty += parseInt(kvo || '0', 10) || 0;
  }
}

// ─── Преобразование в записи products ───────────────────────
const products = [];
for (const g of groups.values()) {
  const rate = RATES[g.valuta] ?? 1;
  const baseUAH = g.cena * rate;
  const price = priceFor(baseUAH);
  const compat = [...g.compat];
  products.push({
    name: g.name,
    category: g.category,
    subcategory: g.subcategory,
    price,
    images: [...g.images],
    brand: g.brand,
    compatibility: compat.length ? compat.join(', ') : null,
    condition: 'Новий',
  });
}

// ─── Дерево категорий/подкатегорий ──────────────────────────
const tree = {};
for (const p of products) {
  tree[p.category] ??= {};
  const sub = p.subcategory || '(без підкатегорії)';
  tree[p.category][sub] = (tree[p.category][sub] || 0) + 1;
}

console.log(`\nВсего карточек после группировки: ${products.length}`);
console.log(`Курсы: USD=${RATES.USD} EUR=${RATES.EUR}\n`);
const sortedCats = Object.keys(tree).sort((a, b) => a.localeCompare(b, 'uk'));
for (const cat of sortedCats) {
  const subs = tree[cat];
  const total = Object.values(subs).reduce((a, b) => a + b, 0);
  console.log(`■ ${cat}  (${total})`);
  for (const sub of Object.keys(subs).sort((a, b) => a.localeCompare(b, 'uk')))
    console.log(`    └ ${sub}  (${subs[sub]})`);
}

// сохраняем дерево + образцы для проверки
const outDir = process.env.OUT_DIR || '.';
writeFileSync(join(outDir, 'import-preview.json'), JSON.stringify({
  totalProducts: products.length,
  rates: RATES,
  tree,
  sample: products.slice(0, 20),
}, null, 2), 'utf8');
console.log(`\nДетали записаны в import-preview.json`);

// Дерево категория → [подкатегории] для UI (генерируется при импорте)
const catalogTree = {};
for (const cat of sortedCats) {
  catalogTree[cat] = Object.keys(tree[cat])
    .filter(s => s !== '(без підкатегорії)')
    .sort((a, b) => a.localeCompare(b, 'uk'));
}
writeFileSync('src/catalogTree.ts',
  `// АВТОГЕНЕРАЦИЯ скриптом scripts/import-products.mjs — не редактировать вручную.\n` +
  `export const catalogTree: Record<string, string[]> = ${JSON.stringify(catalogTree, null, 2)};\n`,
  'utf8');
console.log('Дерево категорий записано в src/catalogTree.ts');

if (DRY_RUN) {
  console.log('\n[DRY-RUN] База данных не изменялась.');
  process.exit(0);
}

// ─── Запись в Supabase ──────────────────────────────────────
if (!SERVICE_KEY) {
  console.error('\nОшибка: не задан SUPABASE_SERVICE_KEY. Запись отменена.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// 1) Удаляем всё, кроме категорий Koch Chemie
console.log('\nУдаляю старые товары (кроме Автохімії Koch Chemie)...');
const keepList = [...KEEP_CATEGORIES];
const { error: delErr } = await supabase
  .from('products')
  .delete()
  .not('category', 'in', `(${keepList.map(c => `"${c}"`).join(',')})`);
if (delErr) { console.error('Ошибка удаления:', delErr); process.exit(1); }
console.log('Старые товары удалены.');

// 2) Вставляем новые пачками по 500
console.log(`Вставляю ${products.length} товаров...`);
const CHUNK = 500;
for (let i = 0; i < products.length; i += CHUNK) {
  const chunk = products.slice(i, i + CHUNK);
  const { error } = await supabase.from('products').insert(chunk);
  if (error) { console.error(`Ошибка вставки (чанк ${i}):`, error); process.exit(1); }
  console.log(`  ${Math.min(i + CHUNK, products.length)} / ${products.length}`);
}
console.log('\nГотово! Импорт завершён.');
