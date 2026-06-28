/**
 * fix-images.mjs
 * Знаходить товари без зображень у Supabase і призначає
 * підходящу заглушку на основі категорії або назви товару.
 *
 * Запуск: node fix-images.mjs
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://vhvedefyixgluayqahhh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZodmVkZWZ5aXhnbHVheXFhaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzE0OTEsImV4cCI6MjA5NjY0NzQ5MX0.RMK8MjUTTOO4slWV5kQw5ue7oAkUQyBFhaXhqz3FGtM'
);

// ── Маппінг категорій → зображення ──────────────────────────
const CATEGORY_IMAGES = {
  'Інвертори':                       'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=400&auto=format&fit=crop&q=70',
  'Автоакустика':                    'https://images.unsplash.com/photo-1545454675-3531b543be5d?w=400&auto=format&fit=crop&q=70',
  'Автомагнітоли':                   'https://images.unsplash.com/photo-1489686995744-f47e995ffe61?w=400&auto=format&fit=crop&q=70',
  'Автомобільне світло':             'https://images.unsplash.com/photo-1503736334956-4c8f8e92946d?w=400&auto=format&fit=crop&q=70',
  'Автомобільний зарядний пристрій': 'https://images.unsplash.com/photo-1542362567-b07e54358753?w=400&auto=format&fit=crop&q=70',
  'Аксесуари':                       'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&auto=format&fit=crop&q=70',
  'Автохімія':                       'https://images.unsplash.com/photo-1607860108855-64acf2078ed9?w=400&auto=format&fit=crop&q=70',
  'Відеореєстратори':                'https://images.unsplash.com/photo-1517524008697-84bbe3c3fd98?w=400&auto=format&fit=crop&q=70',
  'Компресор':                       'https://images.unsplash.com/photo-1487754180451-c456f719a1fc?w=400&auto=format&fit=crop&q=70',
  'Монітори та камери заднього виду':'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?w=400&auto=format&fit=crop&q=70',
  'Навігатори':                      'https://images.unsplash.com/photo-1524661135-423995f22d0b?w=400&auto=format&fit=crop&q=70',
  'Перетворювачі':                   'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&auto=format&fit=crop&q=70',
  'Пускозарядні':                    'https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?w=400&auto=format&fit=crop&q=70',
  'Трансмітери':                     'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=400&auto=format&fit=crop&q=70',
  'Тримачі, розгалужувачі':          'https://images.unsplash.com/photo-1517026575980-3e1e2dedeab4?w=400&auto=format&fit=crop&q=70',
};

// ── Маппінг за ключовими словами в назві ──────────────────────
const KEYWORD_IMAGES = [
  { words: ['парфум', 'twins', 'аромат', 'fragrаnce'],
    url: 'https://images.unsplash.com/photo-1592945403244-b3fbafd7f539?w=400&auto=format&fit=crop&q=70' },
  { words: ['омивач', 'омывач', 'рідина', 'washer fluid', 'rain-x', 'rain x'],
    url: 'https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=400&auto=format&fit=crop&q=70' },
  { words: ['серветка', 'салфетка', 'polishing cloth'],
    url: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&auto=format&fit=crop&q=70' },
  { words: ['глина', 'clay', 'поліроль', 'polish'],
    url: 'https://images.unsplash.com/photo-1607860108855-64acf2078ed9?w=400&auto=format&fit=crop&q=70' },
];

const DEFAULT_IMAGE = 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400&auto=format&fit=crop&q=70';

function pickImage(name, category) {
  const lower = (name || '').toLowerCase();
  for (const entry of KEYWORD_IMAGES) {
    if (entry.words.some(w => lower.includes(w))) return entry.url;
  }
  return CATEGORY_IMAGES[category] || DEFAULT_IMAGE;
}

function isBroken(images) {
  if (!images || images.length === 0) return true;
  const url = images[0];
  if (!url || url.trim() === '') return true;
  // Підозрілі URL: занадто короткі або без домену
  if (url.length < 10 || !url.startsWith('http')) return true;
  return false;
}

async function run() {
  console.log('🔍 Завантаження товарів із Supabase...');
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, category, images');

  if (error) {
    console.error('❌ Помилка запиту:', error.message);
    process.exit(1);
  }

  console.log(`📦 Всього товарів: ${products.length}`);

  const broken = products.filter(p => isBroken(p.images));
  console.log(`🖼️  Товарів без зображень: ${broken.length}\n`);

  if (broken.length === 0) {
    console.log('✅ Всі товари мають зображення. Нічого виправляти.');
    return;
  }

  let fixed = 0;
  for (const p of broken) {
    const newImg = pickImage(p.name, p.category);
    const { error: updateErr } = await supabase
      .from('products')
      .update({ images: [newImg] })
      .eq('id', p.id);

    if (updateErr) {
      console.error(`❌ [${p.id}] ${p.name}: ${updateErr.message}`);
    } else {
      console.log(`✅ [${p.id}] ${p.name}`);
      console.log(`   → ${newImg}\n`);
      fixed++;
    }
  }

  console.log(`\n🎉 Виправлено ${fixed} з ${broken.length} товарів.`);
}

run();
