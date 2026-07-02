import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle, X, Send, Headphones } from 'lucide-react';
import { supabase } from '../supabaseClient';

// ─── Онлайн-чат з менеджером ────────────────────────────────
// Повідомлення клієнта йдуть через /api/chat-send у Telegram власника,
// відповіді з Telegram приходять у Supabase і доставляються сюди Realtime-ом.

interface ChatMessage {
  id: number | string;
  sender: 'client' | 'admin';
  text: string;
  created_at: string;
  failed?: boolean;
}

const SESSION_KEY = 'chat_session_id';

const getSessionId = (): string => {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
};

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
};

export const ChatWidget = () => {
  const [sessionId] = useState(getSessionId);
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [unread, setUnread] = useState(0);

  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;
  const listRef = useRef<HTMLDivElement>(null);
  const historyLoaded = useRef(false);

  // Історія переписки (один раз при монтуванні)
  useEffect(() => {
    if (historyLoaded.current) return;
    historyLoaded.current = true;
    supabase
      .from('chat_messages')
      .select('id, sender, text, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (data && data.length) {
          setMessages(data as ChatMessage[]);
        }
      });
  }, [sessionId]);

  // Realtime: нові повідомлення цієї сесії (відповіді менеджера з Telegram)
  useEffect(() => {
    const channel = supabase
      .channel(`chat-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const m = payload.new as ChatMessage;
          setMessages((prev) =>
            prev.some((x) => x.id === m.id) ? prev : [...prev, m]
          );
          if (m.sender === 'admin' && !isOpenRef.current) {
            setUnread((u) => u + 1);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  // Автопрокрутка вниз
  useEffect(() => {
    if (isOpen && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  const openChat = () => {
    setIsOpen(true);
    setUnread(0);
  };

  // Відкриття чату ззовні (кнопка «Запитати в чаті» в Hero)
  useEffect(() => {
    const handler = () => {
      setIsOpen(true);
      setUnread(0);
    };
    window.addEventListener('open-chat-widget', handler);
    return () => window.removeEventListener('open-chat-widget', handler);
  }, []);

  const sendMessage = useCallback(async () => {
    const text = draft.trim();
    if (!text || isSending) return;
    setDraft('');
    setIsSending(true);

    const tempId = `tmp-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: tempId,
      sender: 'client',
      text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const resp = await fetch('/api/chat-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, text }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || 'send failed');
      const real = data.message as ChatMessage;
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempId);
        return withoutTemp.some((m) => m.id === real.id)
          ? withoutTemp
          : [...withoutTemp, real];
      });
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, failed: true } : m))
      );
    } finally {
      setIsSending(false);
    }
  }, [draft, isSending, sessionId]);

  return (
    <>
      {/* Плаваюча кнопка */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            key="chat-fab"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            onClick={openChat}
            aria-label="Відкрити чат з менеджером"
            className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-violet-700 text-white shadow-2xl shadow-purple-500/30"
          >
            <MessageCircle className="h-6 w-6" />
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white">
                {unread}
              </span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Вікно чату */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="chat-panel"
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-4 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            style={{ height: 'min(480px, calc(100vh - 6rem))' }}
          >
            {/* Шапка */}
            <div className="flex items-center gap-3 bg-gradient-to-r from-purple-700 to-violet-600 px-4 py-3 text-white">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
                <Headphones className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-black">Онлайн-консультант</div>
                <div className="flex items-center gap-1.5 text-[11px] text-purple-100">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                  Зазвичай відповідаємо за кілька хвилин
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                aria-label="Закрити чат"
                className="rounded-lg p-1.5 transition hover:bg-white/15"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Повідомлення */}
            <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto bg-slate-50 p-3">
              <div className="mr-8 rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-700 shadow-sm">
                Вітаємо в AUTOSHOP-MARKET! 👋
                <br />
                Напишіть ваше запитання — менеджер відповість прямо тут.
              </div>

              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.sender === 'client' ? 'justify-end pl-8' : 'justify-start pr-8'}`}
                >
                  <div
                    className={`rounded-2xl px-3 py-2 text-xs leading-5 shadow-sm ${
                      m.sender === 'client'
                        ? `rounded-tr-sm text-white ${m.failed ? 'bg-red-500' : 'bg-purple-600'}`
                        : 'rounded-tl-sm border border-slate-200 bg-white text-slate-700'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                    <div
                      className={`mt-0.5 text-right text-[9px] ${
                        m.sender === 'client' ? 'text-purple-200' : 'text-slate-400'
                      }`}
                    >
                      {m.failed ? 'Не надіслано — спробуйте ще раз' : formatTime(m.created_at)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Поле вводу */}
            <div className="flex items-end gap-2 border-t border-slate-200 bg-white p-2.5">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                rows={1}
                placeholder="Ваше повідомлення..."
                className="max-h-24 flex-1 resize-none rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs outline-none transition focus:border-purple-500 focus:bg-white"
              />
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={sendMessage}
                disabled={!draft.trim() || isSending}
                aria-label="Надіслати"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-600 text-white transition hover:bg-purple-700 disabled:opacity-40"
              >
                <Send className="h-4 w-4" />
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
