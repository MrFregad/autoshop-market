# Онлайн-чат (сайт ↔ Telegram)

Клієнт пише у віджет чату на сайті → повідомлення приходить вам у Telegram
(того самого бота, що приймає замовлення). Ви відповідаєте **Reply** на
повідомлення — відповідь миттєво з'являється у клієнта на сайті.

## Як це працює

1. Віджет ([src/components/ChatWidget.tsx](src/components/ChatWidget.tsx)) відправляє повідомлення на `/api/chat-send`.
2. Функція [api/chat-send.ts](api/chat-send.ts) зберігає його в Supabase (таблиця `chat_messages`) і пересилає в Telegram з тегом `#chat_<id сесії>`.
3. Ваш Reply у Telegram приходить на webhook [api/telegram-webhook.ts](api/telegram-webhook.ts), який зберігає відповідь у Supabase.
4. Віджет підписаний на Supabase Realtime — відповідь з'являється у клієнта миттєво, історія зберігається (localStorage + база).

## Налаштування (один раз)

### 1. Створити таблицю в Supabase — ЄДИНИЙ обов'язковий крок

Відкрийте https://supabase.com/dashboard → ваш проєкт → **SQL Editor** →
вставте вміст файлу [supabase/chat_messages.sql](supabase/chat_messages.sql) → **Run**.

### 2. Webhook Telegram — уже налаштовано ✅

Webhook уже зареєстровано на `https://autoshop-market.vercel.app/api/telegram-webhook`.
Якщо колись треба перереєструвати (наприклад, змінився домен), відкрийте в браузері:

```
https://api.telegram.org/bot<ТОКЕН_БОТА>/setWebhook?url=https://<ВАШ_ДОМЕН>/api/telegram-webhook&secret_token=autoshop_chat_hook_x9K2mQ7pL4vR8sT1
```

### 3. Задеплоїти

Запуште зміни в git — Vercel задеплоїть автоматично.

## Як відповідати клієнтам

- Нове повідомлення приходить у Telegram: `💬 Повідомлення з сайту (клієнт a1b2c3d4)...`
- Зробіть **Reply** (свайп вліво / «Відповісти») на це повідомлення і напишіть відповідь.
- Бот підтвердить: `✅ Відповідь доставлена клієнту на сайт`.
- Звичайне повідомлення боту (без Reply) нікуди не піде — бот підкаже, як правильно.

## Локальна розробка

`npm run dev` показує віджет, але `/api/*` функції працюють лише на Vercel
(або через `vercel dev`). Повний цикл перевіряйте на задеплоєному сайті.
