// POST /api/admin
// Операції адміністратора: вхід, збереження та видалення товарів.
// Пароль перевіряється ТІЛЬКИ на сервері — у код сторінки він не потрапляє.
// Запис у таблицю products іде через цю функцію (напряму з сайту запис закритий RLS).
// Файл самодостатній (без локальних імпортів) — вимога стабільної роботи на Vercel.

// Пароль адміністратора. Рекомендовано задати env-змінну ADMIN_PASSWORD на Vercel.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'AS-market#2026_x7Kq';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://vhvedefyixgluayqahhh.supabase.co';
// Для запису в products потрібен service-ключ (Supabase → Settings → API →
// service_role). Задається env-змінною SUPABASE_SERVICE_KEY на Vercel.
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZodmVkZWZ5aXhnbHVheXFhaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzE0OTEsImV4cCI6MjA5NjY0NzQ5MX0.RMK8MjUTTOO4slWV5kQw5ue7oAkUQyBFhaXhqz3FGtM';

const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// Дозволені поля товару — все зайве відкидається
const PRODUCT_FIELDS = [
  'name', 'category', 'subcategory', 'price', 'old_price', 'images',
  'brand', 'compatibility', 'condition', 'color', 'description', 'badge',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { action, password, product, id } = req.body ?? {};

  if (typeof password !== 'string' || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: 'wrong_password' });
  }

  try {
    if (action === 'login') {
      return res.status(200).json({ ok: true });
    }

    if (action === 'save') {
      if (!product || typeof product !== 'object' ||
          typeof product.name !== 'string' || !product.name.trim() ||
          !Number.isFinite(Number(product.price))) {
        return res.status(400).json({ ok: false, error: 'Invalid product' });
      }
      const clean = {};
      for (const f of PRODUCT_FIELDS) {
        if (f in product) clean[f] = product[f];
      }

      const url = id
        ? `${SUPABASE_URL}/rest/v1/products?id=eq.${Number(id)}`
        : `${SUPABASE_URL}/rest/v1/products`;
      const resp = await fetch(url, {
        method: id ? 'PATCH' : 'POST',
        headers: { ...sbHeaders, Prefer: 'return=representation' },
        body: JSON.stringify(clean),
      });
      if (!resp.ok) {
        const detail = await resp.text();
        console.error('admin save failed:', resp.status, detail);
        return res.status(500).json({ ok: false, error: 'db_failed', detail });
      }
      const data = await resp.json();
      return res.status(200).json({ ok: true, product: data[0] ?? null });
    }

    if (action === 'delete') {
      if (!Number.isFinite(Number(id))) {
        return res.status(400).json({ ok: false, error: 'Invalid id' });
      }
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/products?id=eq.${Number(id)}`,
        { method: 'DELETE', headers: sbHeaders }
      );
      if (!resp.ok) {
        const detail = await resp.text();
        console.error('admin delete failed:', resp.status, detail);
        return res.status(500).json({ ok: false, error: 'db_failed', detail });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ ok: false, error: 'Unknown action' });
  } catch (err) {
    console.error('admin error:', err);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}
