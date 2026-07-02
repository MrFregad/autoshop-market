// POST /api/telegram-webhook
// Webhook Telegram-бота: коли власник відповідає (Reply) на повідомлення
// клієнта в Telegram, відповідь зберігається в Supabase і через Realtime
// миттєво з'являється у віджеті чату на сайті.
// Файл самодостатній (без локальних імпортів) — вимога стабільної роботи на Vercel.

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  '8790461264:AAGLzB3NrwghrfMgHvSt7D19H5d3MoNy_ew';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '7545602942';
const TELEGRAM_WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET || 'autoshop_chat_hook_x9K2mQ7pL4vR8sT1';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://vhvedefyixgluayqahhh.supabase.co';
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZodmVkZWZ5aXhnbHVheXFhaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzE0OTEsImV4cCI6MjA5NjY0NzQ5MX0.RMK8MjUTTOO4slWV5kQw5ue7oAkUQyBFhaXhqz3FGtM';

const SESSION_TAG_RE =
  /#chat_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

async function sendTelegram(text, replyToMessageId) {
  const resp = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        ...(replyToMessageId
          ? { reply_parameters: { message_id: replyToMessageId } }
          : {}),
      }),
    }
  );
  return resp.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false });
  }

  // Перевіряємо, що запит справді від Telegram (секрет задається при setWebhook)
  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (secret !== TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).json({ ok: false });
  }

  try {
    const msg = req.body?.message;

    // Реагуємо лише на текстові повідомлення від власника магазину
    if (!msg?.text || String(msg.chat?.id) !== TELEGRAM_CHAT_ID) {
      return res.status(200).json({ ok: true });
    }

    const repliedText =
      msg.reply_to_message?.text || msg.reply_to_message?.caption;
    const sessionId = repliedText?.match(SESSION_TAG_RE)?.[1]?.toLowerCase();

    if (!sessionId) {
      // Текст без Reply на повідомлення клієнта — підказуємо, як відповідати
      if (!msg.reply_to_message) {
        await sendTelegram(
          'ℹ️ Щоб відповісти клієнту на сайті, зробіть Reply (відповідь) на його повідомлення з тегом #chat_...',
          msg.message_id
        );
      }
      return res.status(200).json({ ok: true });
    }

    const dbResp = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session_id: sessionId,
        sender: 'admin',
        text: msg.text,
      }),
    });

    if (dbResp.ok) {
      await sendTelegram('✅ Відповідь доставлена клієнту на сайт', msg.message_id);
    } else {
      const detail = await dbResp.text();
      console.error('Supabase insert failed:', dbResp.status, detail);
      await sendTelegram(
        '⚠️ Не вдалося доставити відповідь (перевірте таблицю chat_messages у Supabase)',
        msg.message_id
      );
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('telegram-webhook error:', err);
    // Відповідаємо 200, щоб Telegram не повторював запит нескінченно
    return res.status(200).json({ ok: false });
  }
}
