// POST /api/order
// Приймає замовлення з кошика на сайті та надсилає його власнику в Telegram.
// Токен бота живе лише на сервері — у код сторінки він більше не потрапляє.
// Файл самодостатній (без локальних імпортів) — вимога стабільної роботи на Vercel.

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  '8790461264:AAGLzB3NrwghrfMgHvSt7D19H5d3MoNy_ew';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '7545602942';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { name, phone, address, items } = req.body ?? {};

  const str = (v, max) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
  const orderName = str(name, 100);
  const orderPhone = str(phone, 30);
  const orderAddress = str(address, 300);

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
    if (
      !itemName ||
      !Number.isInteger(quantity) || quantity < 1 || quantity > 999 ||
      !Number.isFinite(price) || price < 0 || price > 10_000_000
    ) {
      return res.status(400).json({ ok: false, error: 'Invalid item' });
    }
    safeItems.push({ name: itemName, quantity, price });
  }

  const total = safeItems.reduce((sum, it) => sum + it.price * it.quantity, 0);
  const itemsText = safeItems
    .map((it) => `• ${it.name} — ${it.quantity} шт. x ${it.price} ₴ = ${it.price * it.quantity} ₴`)
    .join('\n');

  const message =
    `🛒 Нове замовлення з AUTOSHOP-MARKET\n\n` +
    `👤 Ім'я: ${orderName}\n📞 Телефон: ${orderPhone}\n📍 Адреса: ${orderAddress}\n\n` +
    `Товари:\n${itemsText}\n\n💰 Разом: ${total} ₴`;

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
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('order error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to send order' });
  }
}
