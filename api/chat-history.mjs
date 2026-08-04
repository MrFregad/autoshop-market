// GET /api/chat-history?session=<uuid>[&after=<id>]
//
// Історія переписки для віджета чату.
//
// Навіщо окрема функція: раніше віджет читав chat_messages напряму анонімним
// ключем, а ключ лежить відкрито в JS-бандлі. Політика була `select using
// (true)` — тобто будь-хто міг вичитати листування ВСІХ клієнтів, а не лише
// своє. Тепер анонімному ключу доступу до таблиці немає зовсім, а сюди
// звертається віджет: сервер віддає рядки ЛИШЕ тієї сесії, яку запитали.
//
// session_id — випадковий uuid у localStorage відвідувача; знати його =
// мати право читати цю розмову. Підібрати його перебором неможливо.
//
// Файл самодостатній (без локальних імпортів) — вимога стабільної роботи на Vercel.

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://vhvedefyixgluayqahhh.supabase.co';
// Тільки service-ключ: анонімний після міграції supabase/chat_rls.sql
// таблицю не бачить, і чат мовчав би без зрозумілої причини.
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  // Історія особиста — ні CDN, ні браузер її кешувати не повинні
  res.setHeader('Cache-Control', 'no-store');

  const session = String(req.query?.session ?? '');
  if (!UUID_RE.test(session)) {
    return res.status(400).json({ ok: false, error: 'bad session' });
  }
  if (!SUPABASE_SERVICE_KEY) {
    console.error('chat-history: немає env SUPABASE_SERVICE_KEY на Vercel');
    return res.status(500).json({ ok: false, error: 'server not configured' });
  }

  // ?after=<id> — довантажити лише нові повідомлення (опитування раз на кілька
  // секунд тягне порожню відповідь, а не всю розмову з початку)
  const after = Number(req.query?.after);
  const filter = Number.isInteger(after) && after > 0 ? `&id=gt.${after}` : '';

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_messages` +
        `?select=id,sender,text,created_at&session_id=eq.${session}${filter}` +
        `&order=id.asc&limit=200`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    if (!resp.ok) throw new Error(`supabase ${resp.status}`);
    return res.status(200).json({ ok: true, messages: await resp.json() });
  } catch (err) {
    console.error('chat-history:', err.message);
    return res.status(502).json({ ok: false, error: 'upstream' });
  }
}
