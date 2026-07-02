// Спільна конфігурація serverless-функцій онлайн-чату (Vercel).
// Файли з префіксом "_" у папці api/ не стають ендпоінтами.
// Значення можна перевизначити через env-змінні на Vercel.

export const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  '8790461264:AAGLzB3NrwghrfMgHvSt7D19H5d3MoNy_ew';

// Telegram-акаунт власника магазину (той самий, куди приходять замовлення)
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '7545602942';

// Секрет, який Telegram надсилає у заголовку webhook-запиту —
// захищає ендпоінт від сторонніх запитів.
export const TELEGRAM_WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET || 'autoshop_chat_hook_x9K2mQ7pL4vR8sT1';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://vhvedefyixgluayqahhh.supabase.co';

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZodmVkZWZ5aXhnbHVheXFhaGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNzE0OTEsImV4cCI6MjA5NjY0NzQ5MX0.RMK8MjUTTOO4slWV5kQw5ue7oAkUQyBFhaXhqz3FGtM';

export interface ChatMessageRow {
  session_id: string;
  sender: 'client' | 'admin';
  text: string;
  client_name?: string | null;
}

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function insertChatMessage(row: ChatMessageRow) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!resp.ok) {
    throw new Error(`Supabase insert failed: ${resp.status} ${await resp.text()}`);
  }
  const data = (await resp.json()) as unknown[];
  return data[0];
}

export async function sendTelegram(text: string, replyToMessageId?: number) {
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
  const data = await resp.json();
  if (!data.ok) {
    throw new Error(`Telegram sendMessage failed: ${JSON.stringify(data)}`);
  }
  return data.result;
}
