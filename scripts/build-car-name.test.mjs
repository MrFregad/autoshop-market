// Перевірка логіки перейменування. Запуск: node scripts/build-car-name.test.mjs
// Усі приклади — реальні рядки з бази, а не вигадані.
import assert from 'node:assert/strict';
import { buildName, cleanName, carLabel, MAX_LEN } from './build-car-name.mjs';

// Головний випадок із задачі: модель переїжджає з дужок у кінець назви.
assert.equal(
  buildName('Бризковики Premium (Partner, Туреччина) Задні', 'Peugeot Partner Tepee 2008-2018').name,
  'Бризковики Premium (Туреччина) Задні Peugeot Partner Tepee 2008-2018',
);

// «Туреччина» — не модель, лишається. Дужки, що спорожніли, зникають разом.
assert.equal(cleanName('Килимки (Partner)', ['Peugeot Partner Tepee 2008-2018']), 'Килимки');
assert.equal(carLabel('Volkswagen T5 Multivan 2003–2010'), 'Volkswagen T5 Multivan');
assert.equal(carLabel('Kia Optima 2016-'), 'Kia Optima');

// Не чіпаємо: «Универсальные» — це не авто, а порожнє поле нічого не додасть.
assert.equal(buildName('Комплект LED ламп H1 Niken', 'Универсальные').name, null);
assert.equal(buildName('Захист дна авто', '').name, null);
assert.equal(buildName('Захист дна авто', null).name, null);

// Модель уже в назві — другий раз не дописуємо. Роки в назві й у сумісності
// різні («2023+» проти «2017-»), тому порівнюємо без них.
assert.equal(buildName('Захист картера Chery Tiggo 8 PRO 2023+ (Пластиковий)', 'Chery Tiggo 8 2017-').name, null);

// Кілька авто: ріжемо тільки по цілих авто і чесно кажемо, що є ще.
const many = buildName(
  'Поперечены на рейлінги під ключ (2 шт)',
  'Citroen Berlingo 2008-2018, Citroen C-4 2004-2010, Citroen Jumpy 1996-2007, Fiat Scudo 1996-2007, Peugeot Expert 1995-2007',
);
assert.ok(many.name.length <= MAX_LEN);
assert.ok(many.name.endsWith(' та інші'), 'решта авто позначена');
assert.ok(many.dropped > 0);
// Обірваного авто в назві бути не може — інакше покупець вирішить, що не підходить
for (const car of many.name.replace(' та інші', '').split(', ').slice(1)) {
  assert.ok(/\d{4}/.test(car), `авто «${car}» обрізане на півслові`);
}

// Дуже довга назва + авто: вкорочуємо назву, але авто лишається цілим.
const long = buildName(
  'Уцінка Накладка над номером (2 дверні, нерж) Напис Caddy, Carmos - Турецька сталь дуже довгий хвіст назви',
  'Volkswagen Caddy 2015-2020',
);
assert.ok(long.name.length <= MAX_LEN, `довжина ${long.name?.length}`);
assert.ok(long.name.endsWith('Volkswagen Caddy 2015-2020'), 'авто не обрізане');

console.log('build-car-name: усі перевірки пройдено');
