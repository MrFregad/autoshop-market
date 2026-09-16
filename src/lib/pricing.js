// Єдине джерело правди для цін: тири націнки, округлення, «стара ціна».
// Використовують і скрипти імпорту (scripts/*.mjs), і сайт (App.tsx),
// тому файл — звичайний .js з типами в pricing.d.ts (як productTitle.js).
//
// Принцип: націнка регресивна — що дорожчий товар, то менший відсоток,
// але більший прибуток у гривнях. На кожному тирі ще й мінімальна націнка
// в гривнях: на дешевих позиціях відсоток з'їдають комісія накладеного
// платежу, повернення та реклама.
//
//   price = round( max( cost × coefficient, cost + minMarginUah ) )

export const PRICE_TIERS = [
  { maxCost: 300,       coefficient: 1.80, minMarginUah: 150 },
  { maxCost: 800,       coefficient: 1.55, minMarginUah: 200 },
  { maxCost: 2000,      coefficient: 1.40, minMarginUah: 350 },
  { maxCost: 5000,      coefficient: 1.28, minMarginUah: 600 },
  { maxCost: 15000,     coefficient: 1.21, minMarginUah: 1200 },
  { maxCost: 40000,     coefficient: 1.14, minMarginUah: 2500 },
  { maxCost: 120000,    coefficient: 1.09, minMarginUah: 4000 },
  { maxCost: Infinity,  coefficient: 1.07, minMarginUah: 8000 },
];

// Від 5000 грн закупівлі ціну диктує ринок, а не формула: такі товари
// перед публікацією звіряємо з 3-5 конкурентами.
export const MARKET_CHECK_THRESHOLD = 5000;

// Безкоштовна доставка — поріг у гривнях (сайт, кошик, FAQ).
export const FREE_SHIPPING_THRESHOLD = 2000;

// «Стара ціна» — лише на дешевих тирах (1-3). На дорогому товарі
// фіктивна знижка виглядає як обман.
const OLD_PRICE_MULTIPLIER = 1.22;
const OLD_PRICE_MAX_TIER_INDEX = 2;

function getTier(cost) {
  const index = PRICE_TIERS.findIndex((t) => cost <= t.maxCost);
  const safeIndex = index === -1 ? PRICE_TIERS.length - 1 : index;
  return { tier: PRICE_TIERS[safeIndex], index: safeIndex };
}

// Округлення завжди вгору: до 1000 — до 10 і мінус 1 (449),
// до 10 000 — до 50 і мінус 10 (2190), далі — до 100 (28 500).
export function roundPrice(value) {
  if (value < 1000) return Math.ceil(value / 10) * 10 - 1;
  if (value < 10000) return Math.ceil(value / 50) * 50 - 10;
  return Math.ceil(value / 100) * 100;
}

export function calculatePrice(cost) {
  if (!Number.isFinite(cost) || cost <= 0) {
    throw new Error(`Некоректна закупівельна ціна: ${cost}`);
  }

  const { tier, index } = getTier(cost);
  const raw = Math.max(cost * tier.coefficient, cost + tier.minMarginUah);
  const price = roundPrice(raw);

  const oldPriceRaw = index <= OLD_PRICE_MAX_TIER_INDEX
    ? roundPrice(price * OLD_PRICE_MULTIPLIER)
    : null;
  const oldPrice = oldPriceRaw && oldPriceRaw > price ? oldPriceRaw : null;

  const marginUah = price - cost;

  return {
    price,
    oldPrice,
    marginUah: Math.round(marginUah),
    marginPercent: Number(((marginUah / cost) * 100).toFixed(1)),
    tierIndex: index,
    needsMarketCheck: cost >= MARKET_CHECK_THRESHOLD,
  };
}

// Ціну правили руками під ринок — чи не впала вона нижче мінімальної націнки.
// Такий товар знімаємо з вітрини, а не продаємо в мінус.
export function isBelowFloor(cost, price) {
  if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(price)) return false;
  const { tier } = getTier(cost);
  return price - cost < tier.minMarginUah;
}
