// Відкат перейменування: name ← name_original.
//
//   node scripts/restore-original-names.mjs           # показує, скільки відкотить
//   node scripts/restore-original-names.mjs --apply   # реально повертає назви
//
// Працює, поки колонка name_original ціла. Її створює supabase/name_original.sql.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://vhvedefyixgluayqahhh.supabase.co';
const BATCH = 500;
const CONCURRENCY = 20;
const APPLY = process.argv.includes('--apply');
const HERE = path.dirname(fileURLToPath(import.meta.url));

const envFile = path.join(HERE, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (APPLY && !SERVICE_KEY) {
  console.error('Помилка: для --apply потрібен SUPABASE_SERVICE_KEY у .env.');
  process.exit(1);
}
// Без --apply вистачає публічного anon-ключа: перевірка тільки читає.
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZodmVkZWZ5aXhnbHVheXFhaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzE0OTEsImV4cCI6MjA5NjY0NzQ5MX0.RMK8MjUTTOO4slWV5kQw5ue7oAkUQyBFhaXhqz3FGtM';
const supabase = createClient(SUPABASE_URL, SERVICE_KEY || ANON_KEY, { auth: { persistSession: false } });

// Відкат — це теж масовий запис, тому робимо його так само партіями й з
// поверненням: щоб на обриві мережі не лишити половину каталогу з новими
// назвами, а половину зі старими без сліду, де саме зупинились.
async function main() {
  console.log(APPLY ? '=== ВІДКАТ НАЗВ (--apply) ===' : '=== ПЕРЕВІРКА ВІДКАТУ, база не змінюється ===');
  let lastId = 0, done = 0, restored = 0, errors = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('products')
      .select('id,name,name_original')
      .gt('id', lastId)
      .order('id')
      .limit(BATCH);
    if (error) {
      console.error('\nПомилка читання:', error.message);
      console.error('Якщо це «column name_original does not exist» — відкочувати нічого, назви не змінювались.');
      process.exit(1);
    }
    if (!data.length) break;

    const todo = data.filter((r) => r.name_original && r.name_original !== r.name);
    if (APPLY) {
      for (let i = 0; i < todo.length; i += CONCURRENCY) {
        const res = await Promise.all(todo.slice(i, i + CONCURRENCY).map(async (r) => {
          const { error: e } = await supabase.from('products').update({ name: r.name_original }).eq('id', r.id);
          return e ? `id ${r.id}: ${e.message}` : null;
        }));
        for (const e of res) if (e) { errors++; console.error('  ' + e); }
      }
    }
    done += data.length;
    restored += todo.length;
    lastId = data[data.length - 1].id;
    process.stdout.write(`\rПереглянуто ${done}, до відкату ${restored}${errors ? `, помилок ${errors}` : ''}...`);
  }
  console.log(`\n\n${APPLY ? 'Повернуто' : 'Буде повернуто'} назв: ${restored} із ${done}.`);
  if (errors) console.log(`ПОМИЛОК: ${errors}`);
  if (!APPLY) console.log('Щоб виконати: node scripts/restore-original-names.mjs --apply');
}
main().catch((e) => { console.error('\nЗбій:', e.message); process.exit(1); });
