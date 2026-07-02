// POST /api/chat-send
// Приймає повідомлення клієнта з віджета чату на сайті:
// зберігає його в Supabase (chat_messages) і пересилає в Telegram.
//
// Якщо налаштована група-кімната чату (команда /setup у групі з темами) —
// кожен клієнт отримує окрему тему (Topic), відповідати можна просто
// повідомленням у темі. Інакше — fallback: особисті повідомлення з тегом
// #chat_... і відповіддю через Reply.
//
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

const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function sbSelect(path) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders });
  if (!resp.ok) return null;
  return resp.json();
}

async function tg(method, payload) {
  const resp = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  return resp.json();
}

// Тема для сесії: беремо збережену або створюємо нову в групі
async function getOrCreateTopic(groupId, sessionId, clientName) {
  const rows = await sbSelect(
    `chat_sessions?session_id=eq.${sessionId}&select=topic_id`
  );
  if (rows?.[0]?.topic_id) return rows[0].topic_id;

  const shortId = sessionId.slice(0, 8);
  const created = await tg('createForumTopic', {
    chat_id: groupId,
    name: `💬 Клієнт ${shortId}` + (clientName ? ` — ${clientName}` : ''),
  });
  if (!created.ok) {
    throw new Error(`createForumTopic failed: ${JSON.stringify(created)}`);
  }
  const topicId = created.result.message_thread_id;

  await fetch(`${SUPABASE_URL}/rest/v1/chat_sessions`, {
    method: 'POST',
    headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      session_id: sessionId,
      topic_id: topicId,
      client_name: clientName,
    }),
  });
  return topicId;
}

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
      headers: { ...sbHeaders, Prefer: 'return=representation' },
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
      return res.status(500).json({ ok: false, error: 'db_insert_failed', detail });
    }
    const [message] = await dbResp.json();

    // 2. Пересилаємо в Telegram
    const config = await sbSelect(
      'chat_config?key=eq.chat_group_id&select=value'
    );
    const groupId = config?.[0]?.value;
    const shortId = sessionId.slice(0, 8);

    if (groupId) {
      // Режим "кімната чату": повідомлення в тему клієнта
      let sent;
      try {
        const topicId = await getOrCreateTopic(groupId, sessionId, clientName);
        sent = await tg('sendMessage', {
          chat_id: groupId,
          message_thread_id: topicId,
          text: text.trim(),
        });
      } catch {
        sent = { ok: false };
      }
      // Тему могли видалити вручну — створюємо заново і повторюємо
      if (!sent?.ok) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/chat_sessions?session_id=eq.${sessionId}`,
          { method: 'DELETE', headers: sbHeaders }
        );
        const topicId = await getOrCreateTopic(groupId, sessionId, clientName);
        await tg('sendMessage', {
          chat_id: groupId,
          message_thread_id: topicId,
          text: text.trim(),
        });
      }
    } else {
      // Fallback: особисті повідомлення власнику з тегом для Reply
      await tg('sendMessage', {
        chat_id: TELEGRAM_CHAT_ID,
        text:
          `💬 Повідомлення з сайту (клієнт ${shortId})` +
          (clientName ? `\n👤 ${clientName}` : '') +
          `\n\n${text.trim()}` +
          `\n\n#chat_${sessionId}` +
          `\n↩️ Щоб відповісти клієнту — зробіть Reply на це повідомлення`,
      });
    }

    return res.status(200).json({ ok: true, message });
  } catch (err) {
    console.error('chat-send error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to send message' });
  }
}
