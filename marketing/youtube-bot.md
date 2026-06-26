# YouTube marketing bot

Це безпечний бот для продвиження AutoShop Market. Він не перезаливає чужі ролики. Його задача: знайти ідеї, підготувати назву/опис/теги та завантажити твій власний готовий відеофайл на YouTube.

## 1. Налаштування

Створи файл `.env` поруч із `.env.example` і заповни значення:

```env
YOUTUBE_API_KEY=...
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
YOUTUBE_REFRESH_TOKEN=...
YOUTUBE_REDIRECT_URI=http://127.0.0.1:53682/oauth2callback
```

`YOUTUBE_API_KEY` потрібен для пошуку ідей. OAuth-поля потрібні тільки для публікації відео.

Щоб отримати `YOUTUBE_REFRESH_TOKEN`, спочатку додай у Google Cloud OAuth redirect URI:

```text
http://127.0.0.1:53682/oauth2callback
```

Потім запусти:

```bash
node scripts/youtubeMarketingBot.mjs auth-url
```

Відкрий посилання, дозволь доступ до YouTube, скопіюй параметр `code` з адресного рядка і обміняй його на refresh token:

```bash
node scripts/youtubeMarketingBot.mjs token --code "CODE_FROM_GOOGLE"
```

Отриманий `YOUTUBE_REFRESH_TOKEN` додай у `.env`.

## 2. Пошук ідей

```bash
npm run youtube:ideas "Компресор автомобільний 12V"
```

Бот знайде схожі ролики на YouTube і запропонує теми для власних Shorts/відео.

## 3. Метадані для ролика

```bash
npm run youtube:metadata "Компресор автомобільний 12V"
```

Команда підготує title, description, tags і короткий сценарій. Посилання на магазин додається автоматично.

## 4. Завантаження власного ролика

```bash
node scripts/youtubeMarketingBot.mjs upload --file "C:\Videos\compressor-short.mp4" --product "Компресор автомобільний 12V" --privacy private
```

Рекомендовано спочатку публікувати як `private` або `unlisted`, перевіряти ролик вручну, а потім відкривати доступ у YouTube Studio.

## Важливо

Не використовуй чужі відео без дозволу. Для стабільного росту каналу краще робити короткі власні ролики: фото/відео товару, субтитри, голос, приклад користі і посилання на магазин.
