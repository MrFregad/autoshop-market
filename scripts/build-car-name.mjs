// Логіка перейменування товару: до назви додаємо марку й модель авто.
//
// Навіщо: у базі назва «Бризковики Premium (Partner, Туреччина) Задні», а
// сумісність «Peugeot Partner Tepee 2008-2018» лежить окремим полем і в
// каталозі не видно. Покупець не розуміє, чи підійде товар його авто, а
// Google не знаходить сторінку по запиту «бризковики Peugeot Partner 2015».
//
// Чистий модуль без мережі — щоб логіку можна булоганяти на вибірці
// (див. build-car-name.test.mjs) до того, як вона піде в базу.

export const MAX_LEN = 120;

// «Универсальные» — це не авто, а «підходить будь-якому». У назві виглядало б
// як сміття: «Комплект LED ламп H1 Niken Pro-series Универсальные».
const UNIVERSAL = /^(универсальн|універсальн)/i;

// Хвіст із роками: «2008-2018», «2016-», «2003–2010» (тире en dash), «2023+».
const YEARS_TAIL = /\s+\d{4}\s*[-–—]?\s*\d{0,4}\s*\+?\s*$/;

const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Список авто з compatibility: «Универсальные» відкидаємо. */
export function parseCars(compatibility) {
  return String(compatibility || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !UNIVERSAL.test(s));
}

/** «Peugeot Partner Tepee 2008-2018» → «Peugeot Partner Tepee». */
export const carLabel = (car) => car.replace(YEARS_TAIL, '').trim();

/**
 * Прибирає з назви дублі моделі всередині дужок:
 * «Бризковики Premium (Partner, Туреччина) Задні» → «Бризковики Premium (Туреччина) Задні».
 * Слово «Туреччина» до моделі не належить — лишається. Якщо дужки спорожніли,
 * прибираємо їх разом із зайвим пробілом.
 */
export function cleanName(name, cars) {
  const modelWords = new Set(
    cars.flatMap((c) => norm(carLabel(c)).split(/[\s/]+/)).filter((w) => w.length > 1),
  );
  return name
    .replace(/\(([^()]*)\)/g, (whole, inner) => {
      const kept = inner
        .split(',')
        .map((f) => f.trim())
        .filter((f) => f && !modelWords.has(norm(f)));
      return kept.length ? `(${kept.join(', ')})` : '';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Нова назва товару або null, якщо чіпати не треба.
 *
 * Повертає { name, cars, dropped, reason }:
 *   reason — чому пропустили (для статистики dry-run).
 */
export function buildName(name, compatibility) {
  const cars = parseCars(compatibility);
  if (!cars.length) {
    return { name: null, reason: String(compatibility || '').trim() ? 'універсальний' : 'немає сумісності' };
  }

  // Модель уже в назві («Захист картера Chery Tiggo 8 PRO» + «Chery Tiggo 8 2017-»)?
  // Порівнюємо по мітці без років: роки в назві й у сумісності часто різні,
  // і пряме порівняння рядків цього дубля не ловило.
  const nName = norm(name);
  if (cars.some((c) => nName.includes(norm(carLabel(c))))) {
    return { name: null, reason: 'модель уже в назві' };
  }

  const base = cleanName(name, cars);

  // Складаємо, поки влазить у ліміт, і тільки цілими авто — обрізати
  // «Ford Ranger 2007-2011, Isuzu D-Ma» не можна: покупець із Isuzu вирішить,
  // що товар не його. Що не влізло — чесно позначаємо «та інші».
  const TAIL = ' та інші';
  const fits = [];
  for (const car of cars) {
    const rest = cars.length > fits.length + 1 ? TAIL : '';
    const candidate = `${base} ${[...fits, car].join(', ')}${rest}`;
    if (candidate.length > MAX_LEN && fits.length) break;
    fits.push(car);
  }

  const dropped = cars.length - fits.length;
  let out = `${base} ${fits.join(', ')}${dropped ? TAIL : ''}`;

  // Навіть одне авто не влізло — вкорочуємо саму назву по словах: марка й
  // модель тут важливіші за хвіст на кшталт «Carmos - Турецька сталь».
  if (out.length > MAX_LEN) {
    const suffix = ` ${fits.join(', ')}${dropped ? TAIL : ''}`;
    const words = base.split(' ');
    while (words.length > 1 && `${words.join(' ')}${suffix}`.length > MAX_LEN) words.pop();
    out = `${words.join(' ')}${suffix}`;
  }

  if (norm(out) === norm(name)) return { name: null, reason: 'без змін' };
  return { name: out.slice(0, MAX_LEN).trim(), cars: fits.length, dropped, reason: 'оновлено' };
}
