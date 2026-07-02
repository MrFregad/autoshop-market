// POST /api/telegram-webhook
// Webhook Telegram-бота: коли власник відповідає (Reply) на повідомлення
// клієнта в Telegram, відповідь зберігається в Supabase і через Realtime
// миттєво з'являється у віджеті чату на сайті.
import {
  insertChatMessage,
  sendTelegram,
  TELEGRAM_CHAT_ID,
  TELEGRAM_WEBHOOK_SECRET,
} from './_lib';

const SESSION_TAG_RE =
  /#chat_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export default async function handler(req: any, res: any) {
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

    const repliedText: string | undefined =
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

    await insertChatMessage({
      session_id: sessionId,
      sender: 'admin',
      text: msg.text,
    });

    await sendTelegram('✅ Відповідь доставлена клієнту на сайт', msg.message_id);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('telegram-webhook error:', err);
    // Відповідаємо 200, щоб Telegram не повторював запит нескінченно
    return res.status(200).json({ ok: false });
  }
}
