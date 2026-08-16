// Додає марку й модель авто до назв товарів у Supabase.
//
//   node scripts/add-car-to-names.mjs              # --dry-run: тільки показує
//   node scripts/add-car-to-names.mjs --apply      # реально пише в базу
//   node scripts/add-car-to-names.mjs --apply --reset   # почати з початку
//
// Потрібен SUPABASE_SERVICE_KEY у .env (Supabase → Settings → API → service_role).
//
// ПЕРЕД --apply один раз виконати supabase/name_original.sql у SQL Editor:
// він створює колонку name_original і копіює туди поточні назви. Без неї
// скрипт відмовиться писати — інакше відкат буде неможливий.
//
// Скрипт перезапускається з місця обриву: після кожної партії записує
// останній оброблений id у scripts/.add-car-to-names-state.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { buildName } from './build-car-name.mjs';

const SUPABASE_URL = 'https://vhvedefyixgluayqahhh.supabase.co';
const BATCH = 500;        // читаємо партіями по 500 рядків
const CONCURRENCY = 20;   // стільки UPDATE-ів паралельно
const RETRIES = 3;

const APPLY = process.argv.includes('--apply');
const RESET = process.argv.includes('--reset');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(HERE, '.add-car-to-names-state.json');

// .env читаємо самі — щоб не тягнути dotenv заради трьох рядків
const envFile = path.join(HERE, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZodmVkZWZ5aXhnbHVheXFhaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzE0OTEsImV4cCI6MjA5NjY0NzQ5MX0.RMK8MjUTTOO4slWV5kQw5ue7oAkUQyBFhaXhqz3FGtM';

if (APPLY && !SERVICE_KEY) {
  console.error('Помилка: для --apply потрібен SUPABASE_SERVICE_KEY у .env. Запис скасовано.');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY || ANON_KEY, { auth: { persistSession: false } });

const readState = () => {
  if (RESET || !fs.existsSync(STATE_FILE)) return { lastId: 0, done: 0, changed: 0 };
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
};
const writeState = (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));

/** Колонка-страховка має існувати ДО того, як ми щось перезапишемо. */
async function assertBackupColumn() {
  const { error } = await supabase.from('products').select('name_original').limit(1);
  if (error) {
    console.error('\nПомилка: у таблиці products немає колонки name_original.');
    console.error('Спочатку виконайте supabase/name_original.sql у Supabase → SQL Editor.');
    console.error('Без неї відкат назв буде неможливий, тому запис скасовано.\n');
    process.exit(1);
  }
}

/** Обробляє масив із обмеженою паралельністю; повертає кількість помилок. */
async function updateAll(items) {
  let errors = 0;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const slice = items.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map(async ({ id, name }) => {
        for (let attempt = 1; attempt <= RETRIES; attempt++) {
          const { error } = await supabase.from('products').update({ name }).eq('id', id);
          if (!error) return null;
          if (attempt === RETRIES) return `id ${id}: ${error.message}`;
          await new Promise((r) => setTimeout(r, 400 * attempt));
        }
      }),
    );
    for (const e of results) if (e) { errors++; console.error('  ' + e); }
  }
  return errors;
}

async function main() {
  console.log(APPLY ? '=== РЕЖИМ ЗАПИСУ (--apply) ===' : '=== ПЕРЕВІРКА (--dry-run), база не змінюється ===');
  if (APPLY) await assertBackupColumn();

  const state = readState();
  if (state.lastId) console.log(`Продовжую з id > ${state.lastId} (оброблено ${state.done}, змінено ${state.changed}).`);

  const stats = {};
  const dropStats = { 'усі авто в назві': 0, 'сховано 1-2 авто': 0, 'сховано 3-5': 0, 'сховано 6-10': 0, 'сховано 11+': 0 };
  const examples = [];
  const perCategory = new Map();
  let lastId = state.lastId, done = state.done, changed = state.changed, errors = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('products')
      .select('id,name,compatibility,category')
      .gt('id', lastId)
      .order('id')
      .limit(BATCH);

    if (error) {
      console.error('\nПомилка читання:', error.message);
      console.error(APPLY ? `Стан збережено, перезапустіть скрипт — продовжить з id > ${lastId}.` : '');
      process.exit(1);
    }
    if (!data.length) break;

    const updates = [];
    for (const row of data) {
      const res = buildName(row.name, row.compatibility);
      stats[res.reason] = (stats[res.reason] || 0) + 1;
      if (!res.name) continue;
      updates.push({ id: row.id, name: res.name });
      const d = res.dropped;
      dropStats[!d ? 'усі авто в назві' : d <= 2 ? 'сховано 1-2 авто' : d <= 5 ? 'сховано 3-5' : d <= 10 ? 'сховано 6-10' : 'сховано 11+']++;
      // Приклади беремо по 2-3 з кожної категорії, а не 50 бризковиків поспіль
      const seen = perCategory.get(row.category) || 0;
      if (examples.length < 50 && seen < 3) {
        perCategory.set(row.category, seen + 1);
        examples.push({ category: row.category, before: row.name, after: res.name, dropped: res.dropped });
      }
    }

    if (APPLY && updates.length) errors += await updateAll(updates);

    done += data.length;
    changed += updates.length;
    lastId = data[data.length - 1].id;
    if (APPLY) writeState({ lastId, done, changed });
    process.stdout.write(`\rОброблено ${done}, змінено ${changed}${errors ? `, помилок ${errors}` : ''}...`);

  }

  console.log('\n');
  if (!APPLY) {
    // добираємо приклади з категорій, які ще не траплялись
    for (const e of examples.slice(0, 50)) {
      console.log(`[${e.category}]`);
      console.log(`  було:  ${e.before}`);
      console.log(`  стало: ${e.after}${e.dropped ? `   ← ще ${e.dropped} авто не влізло` : ''}`);
    }
    console.log('');
  }

  console.log('─── Підсумок ───');
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  for (const [k, v] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
    console.log(`${String(v).padStart(7)}  ${k}  (${(v / total * 100).toFixed(1)}%)`);
  }
  console.log(`${String(total).padStart(7)}  всього переглянуто`);
  if (errors) console.log(`${String(errors).padStart(7)}  ПОМИЛОК ЗАПИСУ`);
  console.log('');
  console.log('─── Скільки авто помістилось у назву ───');
  const upd = Object.values(dropStats).reduce((a, b) => a + b, 0) || 1;
  for (const [k, v] of Object.entries(dropStats)) {
    console.log(`${String(v).padStart(7)}  ${k}  (${(v / upd * 100).toFixed(1)}%)`);
  }
  if (!APPLY) console.log('\nЦе була перевірка. Щоб записати: node scripts/add-car-to-names.mjs --apply');
  else console.log('\nГотово. Відкат: node scripts/restore-original-names.mjs --apply');
}

main().catch((e) => { console.error('\nЗбій:', e.message); process.exit(1); });
