// Массовый пересчёт цен по правилам src/lib/pricing.js.
//
// Запуск:
//   Сухой прогон (ничего не пишет, показывает «было → стало»):
//     node scripts/recalculate-prices.mjs --dry-run
//   Боевой:
//     node scripts/recalculate-prices.mjs
//
// Берёт товары, у которых есть cost_price и price_manual = false.
// Товары с ручной ценой не трогает никогда — их цену выставляли под рынок.
// Закупку заполняют импорты (ddaudio-import.mjs, dropt-import.mjs), поэтому
// обычно этот скрипт нужен только когда поменялись сами тиры в pricing.js.

import { createClient } from '@supabase/supabase-js';
import { calculatePrice, isBelowFloor } from '../src/lib/pricing.js';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const DRY_RUN = process.argv.includes('--dry-run');
const SUPABASE_URL = 'https://vhvedefyixgluayqahhh.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE_KEY) {
  console.error('Ошибка: не задан SUPABASE_SERVICE_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const BATCH = 500;

console.log(`Пересчёт цен${DRY_RUN ? ' [DRY-RUN]' : ''}`);

const updates = [];
const tierCount = {};
const marketCheck = [];
const belowFloor = [];
let scanned = 0, unchanged = 0, raised = 0, lowered = 0, diffSum = 0;

for (let from = 0; ; from += BATCH) {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, price, old_price, cost_price, price_manual')
    .not('cost_price', 'is', null)
    .eq('price_manual', false)
    .order('id')
    .range(from, from + BATCH - 1);
  if (error) {
    console.error('Ошибка чтения (выполнена ли supabase/pricing_migration.sql?):', error.message);
    process.exit(1);
  }
  if (!data.length) break;

  for (const row of data) {
    scanned++;
    const cost = Number(row.cost_price);
    if (!Number.isFinite(cost) || cost <= 0) continue;

    const calc = calculatePrice(cost);
    tierCount[calc.tierIndex] = (tierCount[calc.tierIndex] || 0) + 1;
    if (calc.needsMarketCheck) marketCheck.push({ ...row, cost, next: calc.price });
    if (isBelowFloor(cost, Number(row.price))) belowFloor.push({ ...row, cost });

    if (calc.price === row.price && (calc.oldPrice ?? null) === (row.old_price ?? null)) {
      unchanged++;
      continue;
    }
    const diff = calc.price - Number(row.price);
    if (diff > 0) raised++; else lowered++;
    diffSum += diff;
    updates.push({ id: row.id, price: calc.price, old_price: calc.oldPrice, price_updated_at: new Date().toISOString() });

    if (updates.length <= 20) {
      console.log(`  ${String(row.name).slice(0, 45).padEnd(45)} закупка ${cost.toFixed(0).padStart(7)} | ${String(row.price).padStart(7)} → ${String(calc.price).padStart(7)} (${diff > 0 ? '+' : ''}${diff})`);
    }
  }
  if (data.length < BATCH) break;
}

console.log(`\nПросмотрено: ${scanned}, без изменений: ${unchanged}, к обновлению: ${updates.length} (подорожает ${raised}, подешевеет ${lowered})`);
if (updates.length) {
  console.log(`Средний сдвиг цены: ${(diffSum / updates.length).toFixed(0)} грн`);
}
const tiers = Object.keys(tierCount).sort((a, b) => a - b)
  .map((i) => `тир ${Number(i) + 1}: ${tierCount[i]}`).join(', ');
console.log(`Распределение по тирам — ${tiers || 'пусто'}`);

if (belowFloor.length) {
  console.log(`\n⚠ Продаются ниже минимальной наценки (${belowFloor.length}) — снять с витрины или поднять цену:`);
  for (const r of belowFloor.slice(0, 20)) {
    console.log(`   ${String(r.name).slice(0, 50)}  закупка ${Number(r.cost).toFixed(0)}, цена ${r.price}`);
  }
}

if (marketCheck.length) {
  console.log(`\n⚠ Закупка от 5000 грн — цену диктует рынок, сверьте с 3-5 конкурентами (${marketCheck.length}):`);
  for (const r of marketCheck.slice(0, 30)) {
    console.log(`   ${String(r.name).slice(0, 50)}  закупка ${Number(r.cost).toFixed(0)} → ${r.next} грн`);
  }
}

if (DRY_RUN) {
  console.log('\n[DRY-RUN] База не изменялась.');
  process.exit(0);
}

console.log(`\nОбновляю ${updates.length} товаров...`);
for (let i = 0; i < updates.length; i += 200) {
  const chunk = updates.slice(i, i + 200);
  const { error } = await supabase.from('products').upsert(chunk, { onConflict: 'id' });
  if (error) { console.error(`Ошибка обновления (чанк ${i}):`, error.message); process.exit(1); }
  console.log(`  ${Math.min(i + 200, updates.length)} / ${updates.length}`);
}
console.log('Готово.');
