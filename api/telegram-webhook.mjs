// POST /api/telegram-webhook
// Webhook Telegram-бота. Два режими відповіді клієнту на сайт:
//
// 1. Кімната чату (рекомендовано): група з увімкненими Темами (Topics),
//    бот — адміністратор. Власник надсилає /setup у групі — після цього
//    кожен клієнт отримує окрему тему, і будь-яке повідомлення в темі
//    йде клієнту на сайт (бот ставить 👍, коли доставлено).
//
// 2. Fallback: Reply на повідомлення з тегом #chat_... в особистому чаті з ботом.
//
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

async function insertAdminReply(sessionId, text) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST',
    headers: sbHeaders,
    body: JSON.stringify({ session_id: sessionId, sender: 'admin', text }),
  });
  return resp.ok;
}

// /setup у групі: реєструємо групу як кімнату чату
async function handleSetup(msg) {
  const chatId = String(msg.chat.id);

  if (String(msg.from?.id) !== TELEGRAM_CHAT_ID) {
    return; // команда доступна лише власнику магазину
  }
  if (!msg.chat.is_forum) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '⚠️ Спочатку увімкніть Теми: налаштування групи → «Теми» (Topics) → увімкнути. Потім надішліть /setup ще раз.',
    });
    return;
  }

  // Перевіряємо права бота: пробуємо створити і видалити тестову тему
  const test = await tg('createForumTopic', { chat_id: chatId, name: '✅ Перевірка' });
  if (!test.ok) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '⚠️ Зробіть бота адміністратором групи з правом «Керування темами» (Manage Topics) і надішліть /setup ще раз.',
    });
    return;
  }
  await tg('deleteForumTopic', {
    chat_id: chatId,
    message_thread_id: test.result.message_thread_id,
  });

  // Зберігаємо id групи (upsert)
  await fetch(`${SUPABASE_URL}/rest/v1/chat_config`, {
    method: 'POST',
    headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key: 'chat_group_id', value: chatId }),
  });

  await tg('sendMessage', {
    chat_id: chatId,
    text:
      '✅ Готово! Ця група — кімната чату з клієнтами.\n\n' +
      'Кожен клієнт з сайту отримає окрему тему. Просто пишіть у тему — ' +
      'відповідь миттєво з’явиться у клієнта на сайті (бот ставить 👍, коли доставлено).\n\n' +
      'Замовлення, як і раніше, приходять в особисті повідомлення бота.',
  });
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
    if (!msg?.text) {
      return res.status(200).json({ ok: true });
    }

    const chatIdStr = String(msg.chat?.id);
    const isGroup = msg.chat?.type === 'group' || msg.chat?.type === 'supergroup';

    // ── Команда /setup у групі ──
    if (isGroup && /^\/setup(@\w+)?\s*$/.test(msg.text.trim())) {
      await handleSetup(msg);
      return res.status(200).json({ ok: true });
    }

    // ── Режим "кімната чату": повідомлення в темі групи ──
    if (isGroup && msg.message_thread_id) {
      const config = await sbSelect('chat_config?key=eq.chat_group_id&select=value');
      if (config?.[0]?.value === chatIdStr) {
        const rows = await sbSelect(
          `chat_sessions?topic_id=eq.${msg.message_thread_id}&select=session_id`
        );
        const sessionId = rows?.[0]?.session_id;
        if (sessionId) {
          const ok = await insertAdminReply(sessionId, msg.text);
          if (ok) {
            // Тиха відмітка "доставлено" — реакція 👍 на повідомлення
            await tg('setMessageReaction', {
              chat_id: chatIdStr,
              message_id: msg.message_id,
              reaction: [{ type: 'emoji', emoji: '👍' }],
            });
          } else {
            await tg('sendMessage', {
              chat_id: chatIdStr,
              message_thread_id: msg.message_thread_id,
              text: '⚠️ Не вдалося доставити відповідь клієнту. Спробуйте ще раз.',
            });
          }
        }
      }
      return res.status(200).json({ ok: true });
    }

    // ── Fallback: особистий чат власника, Reply з тегом #chat_... ──
    if (chatIdStr !== TELEGRAM_CHAT_ID) {
      return res.status(200).json({ ok: true });
    }

    const repliedText =
      msg.reply_to_message?.text || msg.reply_to_message?.caption;
    const sessionId = repliedText?.match(SESSION_TAG_RE)?.[1]?.toLowerCase();

    if (!sessionId) {
      if (!msg.reply_to_message && !msg.text.startsWith('/')) {
        await tg('sendMessage', {
          chat_id: TELEGRAM_CHAT_ID,
          text: 'ℹ️ Щоб відповісти клієнту на сайті, зробіть Reply (відповідь) на його повідомлення з тегом #chat_... Або створіть групу-кімнату чату: група з Темами → бот адміністратор → команда /setup.',
          reply_parameters: { message_id: msg.message_id },
        });
      }
      return res.status(200).json({ ok: true });
    }

    const ok = await insertAdminReply(sessionId, msg.text);
    await tg('sendMessage', {
      chat_id: TELEGRAM_CHAT_ID,
      text: ok
        ? '✅ Відповідь доставлена клієнту на сайт'
        : '⚠️ Не вдалося доставити відповідь (перевірте таблицю chat_messages у Supabase)',
      reply_parameters: { message_id: msg.message_id },
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('telegram-webhook error:', err);
    // Відповідаємо 200, щоб Telegram не повторював запит нескінченно
    return res.status(200).json({ ok: false });
  }
}
