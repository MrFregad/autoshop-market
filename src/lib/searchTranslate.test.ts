// Перевірка пошукових фільтрів. Запуск (без жодних залежностей):
//   node --experimental-strip-types src/lib/searchTranslate.test.ts
import assert from 'node:assert/strict';
import { buildSearchFilters } from './searchTranslate.ts';

// Фільтр одного слова → набір варіантів, які реально підуть у базу.
const variants = (q: string) =>
  buildSearchFilters(q).map((f) =>
    [...new Set(f.split(',').map((c) => c.replace(/^\w+\.ilike\.%(.*)%$/, '$1')))],
  );

// Та сама помилка, з якої все почалося: «килимки» шукало повне слово,
// а товар зветься «Килимок» — і сторінка казала «Товарів не знайдено».
assert.ok(variants('килимки')[0].includes('килим'), 'килимки → основа килим');
assert.ok(variants('коврики')[0].includes('килим'), 'рос. коврики → килим');
assert.ok(variants('килимки')[0].includes('коврик'), 'словник працює в обидва боки');
assert.ok(variants('диски')[0].includes('диск'), 'диски → диск');
assert.ok(variants('брызговики')[0].includes('бризков'), 'брызговики → бризков');

// Шукаємо не лише в назві: «Bosch» лежить у brand, «Toyota» — у
// compatibility, «Автохімія» — тільки в category.
const fields = (f: string) => new Set(f.split(',').map((c) => c.split('.')[0]));
assert.deepEqual(
  [...fields(buildSearchFilters('килимки')[0])].sort(),
  ['brand', 'category', 'compatibility', 'name', 'subcategory'],
  'description не шукаємо — див. коментар у SEARCH_FIELDS',
);

// Кілька слів — окремий фільтр на кожне (PostgREST поєднає їх через AND),
// тож «килимки toyota» вимагає обидва слова, у будь-якому полі.
assert.equal(buildSearchFilters('килимки toyota').length, 2);

// Символи, що ламають синтаксис .or() та ilike, не мають туди потрапити.
const values = (q: string) =>
  buildSearchFilters(q).flatMap((f) =>
    f.split(',').map((c) => c.slice(c.indexOf('.ilike.%') + 8, -1)),
  );
assert.deepEqual(
  [...new Set(values('килим%_(a,b)'))].sort(),
  ['килим', 'килимab', 'коврик', 'кілімab'],
  'спецсимволи вичищені, лишились тільки основи',
);
assert.deepEqual(buildSearchFilters('   '), [], 'порожній запит → без фільтрів');

console.log('searchTranslate: усі перевірки пройдено');
