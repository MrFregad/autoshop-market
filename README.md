# AUTOSHOP-MARKET

Интернет-магазин автозапчастей: React + Vite + TypeScript + Tailwind, база — Supabase, хостинг — Vercel. Заказы приходят владельцу в Telegram; товары поставщика Dropt заказываются у него автоматически.

Дополнительные инструкции: [CHAT_SETUP.md](CHAT_SETUP.md) (онлайн-чат), [SECURITY_SETUP.md](SECURITY_SETUP.md) (секреты).

---

## Интеграция с Dropt (dropt.in.ua)

### Разовая настройка

1. **SQL-миграция** (один раз): Supabase → SQL Editor → вставить содержимое
   [`supabase/dropt_migration.sql`](supabase/dropt_migration.sql) → Run.
   Добавляет в `products` поля `supplier`, `supplier_sku`, `supplier_url`, `available`
   и создаёт таблицу `orders`.

2. **Переменные в Vercel**: Project → Settings → Environment Variables → добавить:
   | Имя | Что это |
   |---|---|
   | `DROPT_API_TOKEN` | токен Landing API из кабинета Dropt |
   | `DROPT_API_URL` | точный адрес Landing API (когда придёт документация; пока можно не задавать) |
   | `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → `service_role` (если ещё не добавлен) |

   После добавления переменных нажать **Redeploy**, иначе функции их не увидят.

3. **Секреты в GitHub** (для автообновления товаров): репозиторий → Settings →
   Secrets and variables → Actions → New repository secret:
   - `DROPT_FEED_URL` — персональная ссылка на XML-фид из кабинета Dropt
     (*Налаштування → Prom.ua*, наценка **0%**);
   - `SUPABASE_SERVICE_KEY` — тот же service-ключ.

### Импорт товаров

- **Автоматически**: GitHub Actions запускает импорт каждый день в 06:30 по Киеву
  (workflow «Dropt: імпорт товарів»). Обновляются цены и наличие; товары,
  пропавшие из фида, помечаются «немає в наявності» (не удаляются).
- **Вручную через GitHub**: Actions → «Dropt: імпорт товарів» → Run workflow.
- **Вручную на компьютере** (значения переменных — в локальном `.env`):
  ```bash
  # проверка без записи в базу:
  DROPT_FEED_URL="..." node scripts/dropt-import.mjs --dry-run
  # боевой запуск:
  DROPT_FEED_URL="..." SUPABASE_SERVICE_KEY="..." node scripts/dropt-import.mjs
  ```

Цена продажи = цена дропа **+50%, но наценка не больше 1000 грн** (то же правило,
что и у остальных товаров). Соответствие категорий Dropt → категории сайта правится
в файле [`scripts/dropt-category-map.json`](scripts/dropt-category-map.json).

### Передача заказов в Dropt

Покупатель оформляет заказ на сайте → `/api/order`:
1. отправляет заказ в Telegram (у каждого товара указано, с какого он сайта:
   `dropt.in.ua` со ссылкой и артикулом — или «власний склад»);
2. сохраняет заказ в таблицу `orders`;
3. товары Dropt передаёт в их Landing API. Ошибка Dropt **не блокирует** заказ —
   в Telegram придёт пометка «⚠️ Dropt: ПОМИЛКА передачі», а в `orders`
   останется `dropt_status = 'error'`.

Формат запроса к Dropt целиком живёт в [`api/_lib/droptAdapter.mjs`](api/_lib/droptAdapter.mjs) —
когда придёт документация Landing API, правится только этот файл (и при
необходимости переменная `DROPT_API_URL`).

### Тест эндпоинта вручную (curl)

`/api/dropt-order` — повторная/ручная отправка заказа в Dropt. Защищён паролем
админки (заголовок `x-admin-key` = переменная `ADMIN_PASSWORD` в Vercel):

```bash
curl -X POST https://ВАШ-САЙТ.vercel.app/api/dropt-order \
  -H "Content-Type: application/json" \
  -H "x-admin-key: ПАРОЛЬ_АДМИНКИ" \
  -d '{
    "name": "Тест Тестович",
    "phone": "+380971234567",
    "city": "Дніпро",
    "npOffice": "Відділення №1",
    "orderId": 1,
    "items": [
      { "supplier": "dropt", "supplier_sku": "899279416",
        "name": "Автомагнітола 2DIN 7621", "quantity": 1, "price": 2636 }
    ]
  }'
```

Ответ: `{"ok":true,"status":"sent","droptOrderId":"..."}` — заказ создан у Dropt;
`"status":"error"` — смотреть `detail` и логи Vercel (Functions → Logs).

---

## Локальная разработка

```bash
npm install
npm run dev      # сайт на http://localhost:5173 (api-функции работают только на Vercel)
npm run build    # проверка сборки перед пушем
```

Деплой: любой push в ветку `main` — Vercel собирает и публикует автоматически.
