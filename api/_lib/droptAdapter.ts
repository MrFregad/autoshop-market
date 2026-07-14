// Адаптер Dropt Landing API.
// ЕДИНСТВЕННОЕ место, где живут URL и формат (маппинг полей) запроса к Dropt.
// Когда получим официальную документацию Landing API — правим только этот файл.
//
// Токен берётся ТОЛЬКО из переменной окружения DROPT_API_TOKEN (Vercel →
// Settings → Environment Variables). В коде токена нет и быть не должно.
//
// Папка api/_lib не публикуется как endpoint (Vercel игнорирует файлы,
// чей путь начинается с "_").

export interface DroptOrderItem {
  name: string;
  quantity: number;
  price: number;
  supplier?: string | null;      // 'dropt' | null (свой склад)
  supplier_sku?: string | null;  // артикул Dropt (vendorCode)
}

export interface DroptOrderInput {
  name: string;      // ФИО покупателя
  phone: string;
  city: string;      // город доставки
  npOffice: string;  // отделение Новой Почты
  comment?: string;
  items: DroptOrderItem[];
}

export interface DroptPushResult {
  status: 'sent' | 'skipped' | 'error';
  droptOrderId?: string; // id заказа в Dropt (если создан)
  detail?: string;       // текст ошибки или ответа — для логов
}

// URL можно переопределить переменной окружения DROPT_API_URL —
// пригодится, когда в документации будет точный адрес.
// ВНИМАНИЕ: адрес ниже — предположительный, до получения доков от Dropt.
const DROPT_API_URL =
  process.env.DROPT_API_URL || 'https://dropt.in.ua/api/landing/order';

/**
 * Отправляет заказ в Dropt. Никогда не бросает исключение —
 * любая проблема возвращается как { status: 'error' | 'skipped' },
 * чтобы ошибка Dropt не сломала оформление заказа на сайте.
 */
export async function pushOrderToDropt(
  order: DroptOrderInput
): Promise<DroptPushResult> {
  const token = process.env.DROPT_API_TOKEN;
  if (!token) {
    return { status: 'skipped', detail: 'DROPT_API_TOKEN не задан' };
  }

  // В Dropt передаём только товары этого поставщика
  const droptItems = order.items.filter(
    (i) => i.supplier === 'dropt' && i.supplier_sku
  );
  if (droptItems.length === 0) {
    return { status: 'skipped', detail: 'у замовленні немає товарів Dropt' };
  }

  // ── МАППИНГ ПОЛЕЙ ─────────────────────────────────────────
  // Предположительный формат. После получения доков Dropt
  // корректируем названия полей ЗДЕСЬ и больше нигде.
  const payload = {
    token,
    name: order.name,
    phone: order.phone,
    city: order.city,
    delivery: 'nova_poshta',
    np_office: order.npOffice,
    comment: order.comment || '',
    products: droptItems.map((i) => ({
      sku: i.supplier_sku,
      quantity: i.quantity,
      price: i.price,
    })),
  };

  try {
    // Таймаут 10 секунд, чтобы не подвешивать оформление заказа
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const resp = await fetch(DROPT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await resp.text();
    if (!resp.ok) {
      return { status: 'error', detail: `HTTP ${resp.status}: ${text.slice(0, 300)}` };
    }
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(text); } catch { /* ответ не JSON — не страшно */ }
    const droptOrderId = String(data.order_id ?? data.id ?? '') || undefined;
    return { status: 'sent', droptOrderId, detail: text.slice(0, 300) };
  } catch (err) {
    return { status: 'error', detail: String((err as Error)?.message || err) };
  }
}
