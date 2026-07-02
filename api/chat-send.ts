// POST /api/chat-send
// Приймає повідомлення клієнта з віджета чату на сайті:
// зберігає його в Supabase (chat_messages) і пересилає власнику в Telegram.
import {
  insertChatMessage,
  sendTelegram,
  UUID_RE,
} from './_lib';

export default async function handler(req: any, res: any) {
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
    const message = await insertChatMessage({
      session_id: sessionId,
      sender: 'client',
      text: text.trim(),
      client_name: clientName,
    });

    const shortId = sessionId.slice(0, 8);
    await sendTelegram(
      `💬 Повідомлення з сайту (клієнт ${shortId})` +
        (clientName ? `\n👤 ${clientName}` : '') +
        `\n\n${text.trim()}` +
        `\n\n#chat_${sessionId}` +
        `\n↩️ Щоб відповісти клієнту — зробіть Reply на це повідомлення`
    );

    return res.status(200).json({ ok: true, message });
  } catch (err) {
    console.error('chat-send error:', err);
    return res.status(500).json({ ok: false, error: 'Failed to send message' });
  }
}
