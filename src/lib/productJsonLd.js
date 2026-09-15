// Product JSON-LD — єдиний генератор для сервера (api/meta.mjs) і сайту
// (useProductStructuredData). Googlebot бачить обидві версії, тож вони мусять
// збігатися. Файл .js (а не .ts), як і productTitle.js: api/meta.mjs — чистий
// Node без збірки і TypeScript імпортувати не вміє. Типи — у .d.ts поруч.
//
// review / aggregateRating сюди НЕ додаємо: відгуків на товари немає, а
// вигаданий рейтинг — привід для ручних санкцій Google.

const SITE = 'https://autoshopmarket.com.ua';

// ── Доставка й повернення: міняти тут ──
export const SHIPPING_RATE_UAH = 80;     // вартість доставки, грн
export const FREE_SHIPPING_FROM = 2000;  // від цієї суми доставка безкоштовна (FAQ на сайті)
export const HANDLING_DAYS = [0, 1];     // відправка, днів
export const TRANSIT_DAYS = [1, 3];      // в дорозі, днів
export const RETURN_DAYS = 14;           // строк повернення, днів

const days = ([minValue, maxValue]) => ({ '@type': 'QuantitativeValue', minValue, maxValue, unitCode: 'DAY' });

const absUrl = (src) => {
  try {
    return new URL(String(src), SITE).href;
  } catch {
    return null;
  }
};

export function buildProductJsonLd(p) {
  const url = `${SITE}/product/${p.id}`;
  const price = Number(p.price);
  const condition = String(p.condition ?? '').toLowerCase();
  const used = /used|б\/у|вжив/.test(condition);
  const description = String(p.description ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000);

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    image: (Array.isArray(p.images) ? p.images : []).filter(Boolean).map(absUrl).filter(Boolean).slice(0, 5),
    description: description || p.name,
    sku: String(p.id),
    ...(p.brand ? { brand: { '@type': 'Brand', name: p.brand } } : {}),
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'UAH',
      price,
      // «Під замовлення» — це BackOrder, а не OutOfStock: товар можна купити
      availability: p.available === false ? 'https://schema.org/BackOrder' : 'https://schema.org/InStock',
      itemCondition: used ? 'https://schema.org/UsedCondition' : 'https://schema.org/NewCondition',
      seller: { '@id': `${SITE}/#organization` },
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingRate: {
          '@type': 'MonetaryAmount',
          value: price >= FREE_SHIPPING_FROM ? 0 : SHIPPING_RATE_UAH,
          currency: 'UAH',
        },
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'UA' },
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          handlingTime: days(HANDLING_DAYS),
          transitTime: days(TRANSIT_DAYS),
        },
      },
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'UA',
        returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays: RETURN_DAYS,
        returnMethod: 'https://schema.org/ReturnByMail',
        returnFees: 'https://schema.org/ReturnFeesCustomerResponsibility',
      },
    },
  };
}
