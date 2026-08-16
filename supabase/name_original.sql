-- Страховка перед масовим перейменуванням товарів.
--
-- Скрипт scripts/add-car-to-names.mjs дописує до name марку й модель авто
-- («Бризковики Premium (Туреччина) Задні Peugeot Partner Tepee 2008-2018»).
-- Операція зачіпає ~60 000 рядків, тому спершу зберігаємо поточні назви
-- в окрему колонку — з неї відкат робиться однією командою.
--
-- Якщо SQL Editor покаже «Failed to fetch (api.supabase.com)» — це не помилка
-- бази, а браузер не дочекався відповіді на update по 72 000 рядків. Сам
-- запит при цьому виконується. Перевірити результат можна select-ом нижче.
--
-- Виконати ОДИН РАЗ у Supabase → SQL Editor ПЕРЕД запуском скрипта з --apply.
-- Повторний запуск безпечний: колонка не перестворюється, дані не затираються.

alter table products add column if not exists name_original text;

-- Заповнюємо лише порожні: якщо скрипт уже відпрацював, копіювати нові
-- назви поверх оригіналів не можна — це знищило б єдину копію старих.
update products set name_original = name where name_original is null;

-- Перевірка: обидва числа мають збігтись, і «різних» на цьому етапі має бути 0.
select count(*) as всього,
       count(name_original) as збережено,
       count(*) filter (where name is distinct from name_original) as вже_змінених
from products;
