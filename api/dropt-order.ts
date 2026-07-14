// POST /api/dropt-order
// Ручная (повторная) отправка заказа в Dropt Landing API.
// Обычно заказы уходят в Dropt автоматически внутри /api/order;
// этот endpoint нужен, если передача упала и её надо повторить,
// а также для тестирования интеграции через curl (пример в README).
//
// Защита: заголовок x-admin-key должен совпадать с ADMIN_PASSWORD
// (переменная окружения Vercel) — иначе любой мог бы создавать
// заказы у поставщика от нашего имени.

import { pushOrderToDropt } from './_lib/droptAdapter';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://vhvedefyixgluayqahhh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword || req.headers['x-admin-key'] !== adminPassword) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }

  const { name, phone, city, npOffice, comment, items, orderId } = req.body ?? {};

  if (
    typeof name !== 'string' || !name.trim() ||
    typeof phone !== 'string' || !phone.trim() ||
    typeof city !== 'string' || !city.trim() ||
    typeof npOffice !== 'string' || !npOffice.trim() ||
    !Array.isArray(items) || items.length === 0
  ) {
    return res.status(400).json({
      ok: false,
      error: 'Потрібні поля: name, phone, city, npOffice, items[{supplier, supplier_sku, name, quantity, price}]',
    });
  }

  const result = await pushOrderToDropt({
    name: name.trim(),
    phone: phone.trim(),
    city: city.trim(),
    npOffice: npOffice.trim(),
    comment: typeof comment === 'string' ? comment : undefined,
    items,
  });

  // Если указан orderId — обновляем статус заявки в таблице orders
  if (orderId && SUPABASE_SERVICE_KEY && result.status !== 'skipped') {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${Number(orderId)}`, {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dropt_status: result.status,
          dropt_order_id: result.droptOrderId ?? null,
          dropt_synced_at: new Date().toISOString(),
        }),
      });
    } catch (err) {
      console.error('dropt-order: status update error:', err);
    }
  }

  return res.status(result.status === 'error' ? 502 : 200).json({
    ok: result.status === 'sent',
    status: result.status,
    droptOrderId: result.droptOrderId ?? null,
    detail: result.detail ?? null,
  });
}
