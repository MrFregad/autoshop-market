// POST /api/chat-send
// Приймає повідомлення клієнта з віджета чату на сайті:
// зберігає його в Supabase (chat_messages) і пересилає власнику в Telegram.
// Файл самодостатній (без локальних імпортів) — вимога стабільної роботи на Vercel.

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  '8790461264:AAGLzB3NrwghrfMgHvSt7D19H5d3MoNy_ew';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '7545602942';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://vhvedefyixgluayqahhh.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZodmVkZWZ5aXhnbHVheXFhaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzE0OTEsImV4cCI6MjA5NjY0NzQ5MX0.RMK8MjUTTOO4slWV5kQw5ue7oAkUQyBFhaXhqz3FGtM';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { sessionId, text, name } = req.body ?? {};

  if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) {
    return res.status(400).json({ ok: false, error: 'Invalid sessionId' });
  }
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) {
    return res.status(400).json({ ok: false, error: 'Invalid text' });
  }
  const clientName =
    typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : null;

  try {
    // 1. Зберігаємо повідомлення в Supabase
    const dbResp = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        session_id: sessionId,
        sender: 'client',
        text: text.trim(),
        client_name: clientName,
      }),
    });
    if (!dbResp.ok) {
      const detail = await dbResp.text();
      console.error('Supabase insert failed:', dbResp.status, detail);
      return res.status(500).json({
        ok: false,
        error: 'db_insert_failed',
        detail,
      });
    }
    const [message] = await dbResp.json();

    // 2. Пересилаємо власнику в Telegram
    const shortId = sessionId.slice(0, 8);
    const tgResp = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text:
            `💬 Повідомлення з сайту (клієнт ${shortId})` +
            (clientName ? `\n👤 ${clientName}` : '') +
            `\n\n${text.trim()}` +
            `\n\n#chat_${sessionId}` +
            `\n↩️ Щоб відповісти клієнту — зробіть Reply на це повідомлення`,
        }),
      }
    );
    const tgData = await tgResp.json();
    if (!tgData.ok) {
      console.error('Telegram sendMessage failed:', JSON.stringify(tgData));
      // Повідомлення вже в базі — не вважаємо це фатальною помилкою для клієнта
    }

    return res.status(200).json({ ok: true, message });
  } catch (err) {
    console.error('chat-send error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to send message' });
  }
}
