// <title> товару — спільний для сервера (api/meta.mjs) і сайту (App.tsx):
// Googlebot виконує JS, тож заголовок, який ставить сайт, має збігатися з
// серверним. Разом із « | AutoShop Market» — до 60 символів, інакше Google
// обрізає його у видачі посеред слова.
export const TITLE_SUFFIX = ' | AutoShop Market';
const MAX = 60 - TITLE_SUFFIX.length;

// Обрізає по межі слова; результат разом з «…» не довший за n
export const clipWords = (s, n) => {
  const t = String(s ?? '').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  const space = cut.lastIndexOf(' ');
  return (space > n * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,.;:—–-]+$/, '') + '…';
};

// Авто у заголовку: однакові назви (той самий товар під різні авто) інакше
// дають сотні однакових <title>. Роки прибираємо — задовго.
export function productTitle(name, car) {
  const n = String(name ?? '').trim();
  const carShort = String(car ?? '').split(',')[0]
    .replace(/\s+\d{4}\s*[-–—]?\s*\d{0,4}\s*\+?\s*$/, '').trim();
  const carPart = carShort && !n.toLowerCase().includes(carShort.toLowerCase()) ? ` для ${carShort}` : '';
  let title;
  if (n.length + carPart.length <= MAX) title = n + carPart;
  else if (!carPart || carPart.length > MAX / 2) title = clipWords(n, MAX);
  else title = clipWords(n, MAX - carPart.length) + carPart;
  return title + TITLE_SUFFIX;
}
