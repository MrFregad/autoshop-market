// Адаптер Dropt API v2 (кабінет → Замовлення → API).
// ЕДИНСТВЕННОЕ место, где живут URL и формат запроса к Dropt.
//
//   POST https://dropt.in.ua/api/v2/orders/create
//   Ответ: {success, order_id, paused, pause_reasons[]} | {success:false, error}
//          {success:true, duplicate:true, order_id} — повтор по external_id
//
// Токен — только из DROPT_API_TOKEN (Vercel → Environment Variables).
// Папка api/_lib не публикуется как endpoint (Vercel игнорирует пути с "_").

const DROPT_API_URL =
  process.env.DROPT_API_URL || 'https://dropt.in.ua/api/v2/orders/create';

/**
 * Отправляет заказ в Dropt. Никогда не бросает исключение — любая проблема
 * возвращается статусом, чтобы сбой Dropt не сломал оформление на сайте.
 *
 * @param {{
 *   name: string, phone: string, city: string, npOffice: string,
 *   npRef?: string, externalId?: number|string, comment?: string, test?: boolean,
 *   items: Array<{ name: string, quantity: number, price: number,
 *                  supplier?: string|null, supplier_sku?: string|null }>
 * }} order
 * @returns {Promise<{ status: 'sent'|'skipped'|'error', droptOrderId?: string, detail?: string }>}
 */
export async function pushOrderToDropt(order) {
  const token = process.env.DROPT_API_TOKEN;
  if (!token) return { status: 'skipped', detail: 'DROPT_API_TOKEN не задан' };

  const droptItems = order.items.filter(
    (i) => i.supplier === 'dropt' && i.supplier_sku
  );
  if (droptItems.length === 0) {
    return { status: 'skipped', detail: 'у замовленні немає товарів Dropt' };
  }

  const payload = {
    token,
    // Защита от дублей: повторная отправка вернёт duplicate вместо второго заказа
    external_id: order.externalId ? `autoshop-${order.externalId}` : undefined,
    phone: order.phone,
    name: order.name,
    delivery_type: 'np',
    // address — это WarehouseRef (GUID) отделения НП, текстовые названия Dropt
    // не принимает. На сайте отделение вводится строкой, поэтому шлём GUID
    // только если он есть; иначе Dropt поставит заказ на паузу с причиной
    // «Відділення НП не розпізнано» — отделение дозаполняется в кабинете.
    address: order.npRef || undefined,
    payment: 'cod',
    comment: [order.city, order.npOffice, order.comment].filter(Boolean).join(' | '),
    products: droptItems.map((i) => ({
      sku: i.supplier_sku,
      quantity: i.quantity,
      price: i.price,
    })),
    test: order.test || undefined,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const resp = await fetch(DROPT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await resp.text();
    let data = {};
    try { data = JSON.parse(text); } catch { /* ответ не JSON */ }

    if (!data.success) {
      return { status: 'error', detail: String(data.error || text).slice(0, 300) };
    }
    const detail = data.duplicate
      ? 'дубль (замовлення вже було)'
      : data.paused
        ? `на паузі: ${(data.pause_reasons || []).join(', ')}`
        : 'прийнято';
    return {
      status: 'sent',
      droptOrderId: String(data.order_id ?? '') || undefined,
      detail,
    };
  } catch (err) {
    return { status: 'error', detail: String(err?.message || err) };
  }
}
