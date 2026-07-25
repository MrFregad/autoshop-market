// GET /api/np — довідник Нової Пошти (міста та відділення).
// Проксі до Dropt API v2, щоб токен не потрапляв на фронтенд.
//   /api/np?type=cities&search=Дніпро      → [{ref, name, area}]
//   /api/np?type=warehouses&city_ref=<GUID> → [{ref, number, name}]
// Відділення обов'язкове саме як ref (GUID) — Dropt відхиляє текстові назви.

const DROPT_NP_URL = 'https://dropt.in.ua/api/v2/np';

export default async function handler(req, res) {
  const token = process.env.DROPT_API_TOKEN;
  if (!token) return res.status(500).json({ ok: false, error: 'no_token' });

  const { type, search, city_ref: cityRef } = req.query ?? {};

  let url;
  if (type === 'cities') {
    if (typeof search !== 'string' || search.trim().length < 2) {
      return res.status(200).json({ ok: true, items: [] });
    }
    url = `${DROPT_NP_URL}/cities?token=${token}&search=${encodeURIComponent(search.trim())}`;
  } else if (type === 'warehouses') {
    if (typeof cityRef !== 'string' || !cityRef) {
      return res.status(400).json({ ok: false, error: 'city_ref required' });
    }
    url = `${DROPT_NP_URL}/warehouses?token=${token}&city_ref=${encodeURIComponent(cityRef)}`;
  } else {
    return res.status(400).json({ ok: false, error: 'bad type' });
  }

  try {
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.success) {
      return res.status(502).json({ ok: false, error: String(data.error || 'np_failed') });
    }
    // Довідник змінюється рідко — дозволяємо кешувати на годину
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json({ ok: true, items: data.cities ?? data.warehouses ?? [] });
  } catch (err) {
    console.error('np error:', err);
    return res.status(500).json({ ok: false, error: 'fetch_failed' });
  }
}
