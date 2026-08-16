// ─────────────────────────────────────────────────────────────
// Воронка: де саме відвалюються покупці.
//
// Події йдуть у Vercel Analytics (track). Пошукові запити ДОДАТКОВО пишуться
// в таблицю search_log: у Vercel немає API, щоб прочитати свої ж події назад,
// тож зібрати з них звіт «топ-50 запитів» неможливо. Саме ці два списки —
// що шукали і чого не знайшли — і є головна підказка, що додати в каталог,
// тому вони мусять лежати там, звідки їх можна дістати запитом.
// ─────────────────────────────────────────────────────────────
import { track } from '@vercel/analytics';
import { supabase } from '../supabaseClient';

// Vercel обрізає значення властивостей; довгі назви товарів і запити
// однаково не потрібні цілком — важлива група, а не кожен символ.
const clip = (s: unknown, n = 100) => String(s ?? '').trim().slice(0, n);

// Жодна аналітика не має права зламати сторінку покупцеві.
const safe = (name: string, props?: Record<string, string | number | boolean | null>) => {
  try {
    track(name, props);
  } catch {
    /* аналітика не працює — магазин працює далі */
  }
};

export const trackHomeView = () => safe('page_view_home');

export const trackCarSelector = (mark: string, model: string) =>
  safe('car_selector_used', { mark: clip(mark, 60), model: clip(model, 80) });

export const trackProductView = (p: { id: number; name: string; category?: string; price: number }) =>
  safe('product_view', {
    id: p.id,
    name: clip(p.name),
    category: clip(p.category, 60),
    price: p.price,
  });

export const trackAddToCart = (p: { id: number; name: string; price: number }) =>
  safe('add_to_cart', { id: p.id, name: clip(p.name), price: p.price });

export const trackCheckoutStarted = (items: number, total: number) =>
  safe('checkout_started', { items, total });

export const trackOrderSubmitted = (items: number, total: number) =>
  safe('order_submitted', { items, total });

/**
 * Пошук. Викликається ОДИН раз на завершений запит (після дебаунсу й після
 * того, як прийшла відповідь), а не на кожну літеру — інакше в журналі
 * замість «килимки» осіли б «к», «ки», «кил»…
 *
 * results === 0 → окрема подія search_empty: це і є список того, чого в
 * каталозі бракує.
 */
export const trackSearch = (query: string, results: number) => {
  const q = clip(query, 120);
  if (!q) return;

  safe('search_performed', { query: q, results });
  if (results === 0) safe('search_empty', { query: q });

  // Дубль у власну базу — щоб /admin/stats було з чого будувати.
  // Помилку ковтаємо: журнал аналітики не вартий зламаного пошуку.
  supabase.from('search_log').insert({ query: q, results }).then(
    () => {},
    () => {},
  );
};
