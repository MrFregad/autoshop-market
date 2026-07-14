// POST /api/order
// Принимает заказ с сайта и делает три вещи:
//   1. Отправляет заказ владельцу в Telegram (главный канал — как раньше).
//      Для каждого товара указывается, с какого сайта он: Dropt или свой склад.
//   2. Сохраняет заказ в Supabase (таблица orders) — история заказов.
//   3. Передаёт товары Dropt поставщику через Landing API (адаптер).
// Ошибки шагов 2 и 3 НЕ блокируют оформление: заказ уже у владельца в Telegram,
// проблемы только логируются (Vercel → Functions → Logs).
//
// Единственный локальный импорт — адаптер Dropt (с явным расширением .mjs,
// иначе функция падает на Vercel при "type":"module").

import { pushOrderToDropt } from './_lib/droptAdapter.mjs';

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  '8790461264:AAGLzB3NrwghrfMgHvSt7D19H5d3MoNy_ew';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '7545602942';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://vhvedefyixgluayqahhh.supabase.co';
// Анонимный ключ — только для ЧТЕНИЯ товаров (supplier/артикул).
// Записать заказ в orders может только service-ключ (RLS без политик).
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZodmVkZWZ5aXhnbHVheXFhaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzE0OTEsImV4cCI6MjA5NjY0NzQ5MX0.RMK8MjUTTOO4slWV5kQw5ue7oAkUQyBFhaXhqz3FGtM';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

function sbHeaders(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { name, phone, address, city, npOffice, items } = req.body ?? {};

  const str = (v, max) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
  const orderName = str(name, 100);
  const orderPhone = str(phone, 30);
  // Новый формат — город + отделение; старый (одной строкой) тоже принимаем
  const orderCity = str(city, 100);
  const orderOffice = str(npOffice, 200);
  const orderAddress =
    str(address, 300) ||
    (orderCity && orderOffice ? `${orderCity}, ${orderOffice}` : null);

  if (!orderName || !orderPhone || !orderAddress) {
    return res.status(400).json({ ok: false, error: 'Missing fields' });
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    return res.status(400).json({ ok: false, error: 'Invalid items' });
  }

  const safeItems = [];
  for (const it of items) {
    const itemName = str(it?.name, 300);
    const quantity = Number(it?.quantity);
    const price = Number(it?.price);
    const id = Number.isInteger(Number(it?.id)) ? Number(it.id) : null;
    if (
      !itemName ||
      !Number.isInteger(quantity) || quantity < 1 || quantity > 999 ||
      !Number.isFinite(price) || price < 0 || price > 10_000_000
    ) {
      return res.status(400).json({ ok: false, error: 'Invalid item' });
    }
    safeItems.push({ id, name: itemName, quantity, price });
  }

  // ── Поставщик каждого товара: берём из базы, а не с клиента ──
  const supplierById = new Map();
  const ids = safeItems.map((i) => i.id).filter((v) => v !== null);
  if (ids.length > 0) {
    try {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/products?id=in.(${ids.join(',')})&select=id,supplier,supplier_sku,supplier_url`,
        { headers: sbHeaders(SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY) }
      );
      if (resp.ok) {
        const rows = await resp.json();
        for (const r of rows) supplierById.set(r.id, r);
      }
    } catch (err) {
      console.error('order: supplier lookup failed:', err);
    }
  }

  const enrichedItems = safeItems.map((it) => {
    const p = it.id !== null ? supplierById.get(it.id) : undefined;
    return {
      ...it,
      supplier: p?.supplier ?? null,
      supplier_sku: p?.supplier_sku ?? null,
      supplier_url: p?.supplier_url ?? null,
    };
  });

  const total = enrichedItems.reduce((sum, it) => sum + it.price * it.quantity, 0);

  // ── 1. Telegram: сообщение владельцу ──────────────────────
  // Для каждого товара — с какого сайта он (Dropt со ссылкой или свой склад)
  const itemsText = enrichedItems
    .map((it) => {
      const line = `• ${it.name} — ${it.quantity} шт. x ${it.price} ₴ = ${it.price * it.quantity} ₴`;
      if (it.supplier === 'dropt') {
        const art = it.supplier_sku ? `, арт. ${it.supplier_sku}` : '';
        const url = it.supplier_url ? `\n    ${it.supplier_url}` : '';
        return `${line}\n    🌐 Сайт: dropt.in.ua${art}${url}`;
      }
      return `${line}\n    🏠 Сайт: власний склад`;
    })
    .join('\n');

  const deliveryText = orderCity && orderOffice
    ? `🏙 Місто: ${orderCity}\n📦 Відділення: ${orderOffice}`
    : `📍 Адреса: ${orderAddress}`;

  let message =
    `🛒 Нове замовлення з AUTOSHOP-MARKET\n\n` +
    `👤 Ім'я: ${orderName}\n📞 Телефон: ${orderPhone}\n${deliveryText}\n\n` +
    `Товари:\n${itemsText}\n\n💰 Разом: ${total} ₴`;

  // ── 2. Сохраняем заказ в Supabase (не блокирует) ──────────
  let orderId = null;
  if (SUPABASE_SERVICE_KEY) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/rest/v1/orders`, {
        method: 'POST',
        headers: { ...sbHeaders(SUPABASE_SERVICE_KEY), Prefer: 'return=representation' },
        body: JSON.stringify({
          name: orderName,
          phone: orderPhone,
          city: orderCity,
          np_office: orderOffice,
          address_full: orderAddress,
          items: enrichedItems,
          total,
        }),
      });
      if (resp.ok) {
        const rows = await resp.json();
        orderId = rows?.[0]?.id ?? null;
      } else {
        console.error('order: db insert failed:', resp.status, await resp.text());
      }
    } catch (err) {
      console.error('order: db insert error:', err);
    }
  } else {
    console.error('order: SUPABASE_SERVICE_KEY не задан — заказ не сохранён в БД');
  }

  // ── 3. Передаём в Dropt (не блокирует) ────────────────────
  const droptResult = await pushOrderToDropt({
    name: orderName,
    phone: orderPhone,
    city: orderCity || orderAddress,
    npOffice: orderOffice || orderAddress,
    comment: `Замовлення №${orderId ?? '—'} з autoshop-market`,
    items: enrichedItems,
  });
  if (droptResult.status === 'error') {
    console.error('order: dropt push failed:', droptResult.detail);
  }

  // Фиксируем результат Dropt в заказе
  if (orderId !== null && SUPABASE_SERVICE_KEY && droptResult.status !== 'skipped') {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`, {
        method: 'PATCH',
        headers: sbHeaders(SUPABASE_SERVICE_KEY),
        body: JSON.stringify({
          dropt_status: droptResult.status,
          dropt_order_id: droptResult.droptOrderId ?? null,
          dropt_synced_at: new Date().toISOString(),
        }),
      });
    } catch (err) {
      console.error('order: dropt status update error:', err);
    }
  }

  if (orderId !== null) message += `\n\n📋 Заявка #${orderId} збережена в базі`;
  if (droptResult.status === 'sent') {
    message += `\n🚀 Dropt: передано${droptResult.droptOrderId ? ` (№${droptResult.droptOrderId})` : ''}`;
  } else if (droptResult.status === 'error') {
    message += `\n⚠️ Dropt: ПОМИЛКА передачі — оформіть вручну!`;
  }

  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message }),
      }
    );
    const data = await resp.json();
    if (!data.ok) {
      console.error('order sendMessage failed:', JSON.stringify(data));
      return res.status(500).json({ ok: false, error: 'telegram_failed' });
    }
    return res.status(200).json({ ok: true, orderId, dropt: droptResult.status });
  } catch (err) {
    console.error('order error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to send order' });
  }
}
