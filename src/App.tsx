import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, ShoppingCart, X, Plus, Minus,
  Trash2, Edit2, ArrowLeft, Star,
  Phone, Mail, Clock, Truck, CreditCard, AlertTriangle,
  PackageCheck, MapPin, Flame, ChevronRight, ChevronLeft,
  Zap, Shield, Headphones, Percent, Tag,
  TruckIcon, Wallet, FileText, MessageCircle, Link2, Check
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router';
import { Analytics } from '@vercel/analytics/react';
import { supabase } from './supabaseClient';
import { useProductStructuredData } from './hooks/useProductStructuredData';
import { catalogTree } from './catalogTree';

// ─── Types ──────────────────────────────────────────────────
interface Product {
  id: number;
  name: string;
  category: string;
  subcategory?: string;
  price: number;
  old_price?: number;
  images: string[];
  brand?: string;
  compatibility?: string;
  condition?: string;
  color?: string;
  description?: string;
  badge?: 'hot' | 'sale' | 'top' | 'new';
}

interface CartItem extends Product { quantity: number; }

interface Review {
  id: number;
  product_id: number;
  author: string;
  rating: number;
  text: string;
  date: string;
}

interface CategoryItem {
  name: string;
  image: string;
  subtitle: string;
}

// ─── Image Fallbacks by Category ────────────────────────────
const CATEGORY_FALLBACKS: Record<string, string> = {
  'Інвертори':                      'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=400&auto=format&fit=crop&q=70',
  'Автоакустика':                   'https://images.unsplash.com/photo-1545454675-3531b543be5d?w=400&auto=format&fit=crop&q=70',
  'Автомагнітоли':                  'https://images.unsplash.com/photo-1489686995744-f47e995ffe61?w=400&auto=format&fit=crop&q=70',
  'Автомобільне світло':            'https://images.unsplash.com/photo-1503736334956-4c8f8e92946d?w=400&auto=format&fit=crop&q=70',
  'Автомобільний зарядний пристрій':'https://images.unsplash.com/photo-1542362567-b07e54358753?w=400&auto=format&fit=crop&q=70',
  'Аксесуари':                      'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&auto=format&fit=crop&q=70',
  'Автохімія':                      'https://images.unsplash.com/photo-1607860108855-64acf2078ed9?w=400&auto=format&fit=crop&q=70',
  'Відеореєстратори':               'https://images.unsplash.com/photo-1517524008697-84bbe3c3fd98?w=400&auto=format&fit=crop&q=70',
  'Компресор':                      'https://images.unsplash.com/photo-1487754180451-c456f719a1fc?w=400&auto=format&fit=crop&q=70',
  'Монітори та камери заднього виду':'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?w=400&auto=format&fit=crop&q=70',
  'Навігатори':                     'https://images.unsplash.com/photo-1524661135-423995f22d0b?w=400&auto=format&fit=crop&q=70',
  'Перетворювачі':                  'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&auto=format&fit=crop&q=70',
  'Пускозарядні':                   'https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?w=400&auto=format&fit=crop&q=70',
  'Трансмітери':                    'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=400&auto=format&fit=crop&q=70',
  'Тримачі, розгалужувачі':         'https://images.unsplash.com/photo-1517026575980-3e1e2dedeab4?w=400&auto=format&fit=crop&q=70',
};
const DEFAULT_FALLBACK = 'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=400&auto=format&fit=crop&q=70';

// Returns a category-appropriate fallback image URL
const getFallbackImage = (category?: string): string =>
  (category && CATEGORY_FALLBACKS[category]) || DEFAULT_FALLBACK;

// onError handler for <img> — swaps src to fallback once, prevents loop
const imgError = (category?: string) => (e: React.SyntheticEvent<HTMLImageElement>) => {
  const img = e.currentTarget;
  img.onerror = null;
  img.src = getFallbackImage(category);
};

// Safe first image URL — returns fallback if array is empty/undefined
const firstImg = (images: string[] | undefined, category?: string): string =>
  images?.[0] || getFallbackImage(category);

// ─── Constants ──────────────────────────────────────────────
const TELEGRAM_BOT_TOKEN = '8790461264:AAGLzB3NrwghrfMgHvSt7D19H5d3MoNy_ew';
const TELEGRAM_CHAT_ID = '7545602942';
const ADMIN_PASSWORD = 'admin123';

const categories: CategoryItem[] = [
  { name: 'Усі', subtitle: '', image: '' },
  { name: 'Універсальні аксесуари', subtitle: '', image: '' },
  { name: 'Автолампи', subtitle: '', image: '' },
  { name: 'Автосвітло', subtitle: '', image: '' },
  { name: 'Аксесуари для авто в салон', subtitle: '', image: '' },
  { name: 'Бризговики', subtitle: '', image: '' },
  { name: 'Дефлектори', subtitle: '', image: '' },
  { name: 'Багажники/дуги на дах', subtitle: '', image: '' },
  { name: 'Запчастини кузова', subtitle: '', image: '' },
  { name: 'Кенгурятники та підніжки', subtitle: '', image: '' },
  { name: 'Килимки', subtitle: '', image: '' },
  { name: 'Ковпаки', subtitle: '', image: '' },
  { name: 'Обвіси', subtitle: '', image: '' },
  { name: 'OffRoad аксесуари', subtitle: '', image: '' },
  { name: 'Універсальні автоаксесуари', subtitle: '', image: '' },
  { name: 'Хром накладки', subtitle: '', image: '' },
  { name: 'Шильдики', subtitle: '', image: '' },
  { name: 'Шумовіброізоляція', subtitle: '', image: '' },
  { name: 'Електроніка', subtitle: '', image: '' },
  { name: 'Захист днища', subtitle: '', image: '' },
  { name: 'Чохли', subtitle: '', image: '' },
  { name: 'Листовий пластик (для тюнінгу)', subtitle: '', image: '' },
  { name: 'Автомобільні диски', subtitle: '', image: '' },
  // Автохімія підкатегорії (Koch Chemie)
  { name: 'Мийка авто', subtitle: '', image: '' },
  { name: "Екстер'єр", subtitle: '', image: '' },
  { name: "Інтер'єр", subtitle: '', image: '' },
  { name: 'COLOURLOCK', subtitle: '', image: '' },
  { name: 'Скло', subtitle: '', image: '' },
  { name: 'NANO-захист', subtitle: '', image: '' },
  { name: 'Консерванти', subtitle: '', image: '' },
  { name: 'Поліювання', subtitle: '', image: '' },
  { name: 'Обладнання (хімія)', subtitle: '', image: '' },
  { name: 'Аксесуари (хімія)', subtitle: '', image: '' },
  { name: 'Аромосаше', subtitle: '', image: '' },
  { name: 'Набори (хімія)', subtitle: '', image: '' },
  { name: 'Брендована продукція', subtitle: '', image: '' },
];

const chemistrySubcategoryNames = new Set([
  'Мийка авто', "Екстер'єр", "Інтер'єр", 'COLOURLOCK', 'Скло',
  'NANO-захист', 'Консерванти', 'Поліювання', 'Обладнання (хімія)',
  'Аксесуари (хімія)', 'Аромосаше', 'Набори (хімія)', 'Брендована продукція',
]);

const oversizedCategories = [
  'Дитячі автокрісла', 'Лебідки електричні', 'Автомобільні акумулятори', 'Вантажні акумулятори',
  'Вантажні бокси', 'Велокріплення', 'Захист днища', 'Багажники на дах', 'Лодочні акумулятори',
  'Фаркопи', 'Лежаки', 'Тягові акумулятори', 'Мото акумулятори', 'Силові бампери та дуги',
  'Антикрила та спойлери', 'Решітки радіатора', 'Багажні корзини', 'Крани і гідравлічні циліндри',
  'Домкрати підкатні', 'Домкрати рейкові', 'Ручні лебідки', 'Автопалатки', 'Павільйони', 'Дитячі велокрісла',
];

// ─── Sample products for demo ───────────────────────────────
const sampleProducts: Product[] = [
  { id: 1, name: 'Автомагнітола Pioneer MVH-S120UBG', category: 'Автомагнітоли', price: 1899, old_price: 2499, images: ['https://images.unsplash.com/photo-1489686995744-f47e995ffe61?w=400'], brand: 'Pioneer', condition: 'Новий', color: 'Чорний', description: 'Сучасна магнітола з USB, AUX та FM-тюнером. Потужність 4x50W.', badge: 'hot' },
  { id: 2, name: 'Компресор автомобільний 12V', category: 'Компресор', price: 899, old_price: 1299, images: ['https://images.unsplash.com/photo-1487754180451-c456f719a1fc?w=400'], brand: 'Vitol', condition: 'Новий', color: 'Чорний', description: 'Компактний компресор для шин. Тиск до 7 бар.', badge: 'sale' },
  { id: 3, name: 'LED-фари денного світла Philips', category: 'Автомобільне світло', price: 1299, old_price: 1699, images: ['https://images.unsplash.com/photo-1503736334956-4c8f8e92946d?w=400'], brand: 'Philips', condition: 'Новий', color: 'Білий', description: 'Яскраві LED-фари DRL. Довговічні діоди.', badge: 'hot' },
  { id: 4, name: 'Автомобільний інвертор 2000W', category: 'Інвертори', price: 4599, old_price: 5999, images: ['https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=400'], brand: 'Energizer', condition: 'Новий', color: 'Чорний', description: 'Перетворювач напруги 12V -> 220V. Чиста синусоїда.', badge: 'top' },
  { id: 5, name: 'Відеореєстратор Xiaomi 70mai A500S', category: 'Відеореєстратори', price: 3299, old_price: 3999, images: ['https://images.unsplash.com/photo-1517524008697-84bbe3c3fd98?w=400'], brand: 'Xiaomi', condition: 'Новий', color: 'Чорний', description: '2K зйомка, GPS, ADAS, Wi-Fi. Подвійна камера.', badge: 'hot' },
  { id: 6, name: 'FM-трансмітер Baseus Bluetooth', category: 'Трансмітери', price: 599, old_price: 899, images: ['https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=400'], brand: 'Baseus', condition: 'Новий', color: 'Чорний', description: 'Bluetooth 5.0, швидка зарядка QC 3.0, гучний зв\u2019язок.', badge: 'sale' },
  { id: 7, name: 'Пуско-зарядний пристрій 18000mAh', category: 'Пускозарядні', price: 2799, old_price: 3499, images: ['https://images.unsplash.com/photo-1619642751034-765dfdf7c58e?w=400'], brand: 'CarJump', condition: 'Новий', color: 'Помаранчевий', description: 'Запуск двигуна до 6.0L бензин / 3.0L дизель.', badge: 'hot' },
  { id: 8, name: 'Автомобільна зарядка Quick Charge 3.0', category: 'Автомобільний зарядний пристрій', price: 299, old_price: 499, images: ['https://images.unsplash.com/photo-1542362567-b07e54358753?w=400'], brand: 'Anker', condition: 'Новий', color: 'Чорний', description: 'Швидка зарядка для всіх пристроїв. 2xUSB порти.', badge: 'new' },
];

// ─── Animation Variants ─────────────────────────────────────
const fadeInUp = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.06, duration: 0.5, ease: 'easeOut' as const } }),
};

const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.4 } },
};



// ─── Helper Components ──────────────────────────────────────
const DiscountBadge = ({ oldPrice, price }: { oldPrice?: number; price: number }) => {
  if (!oldPrice || oldPrice <= price) return null;
  const percent = Math.round(((oldPrice - price) / oldPrice) * 100);
  return (
    <motion.div
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      className="absolute top-2 right-2 z-20 bg-gradient-to-r from-red-500 to-orange-500 text-white text-[10px] font-black px-2 py-1 rounded-full shadow-lg"
    >
      -{percent}%
    </motion.div>
  );
};

const ProductBadge = ({ type }: { type?: string }) => {
  if (!type) return null;
  const configs: Record<string, { bg: string; text: string; label: string; icon: React.ReactNode }> = {
    hot: { bg: 'from-red-500 to-orange-500', text: 'text-white', label: 'ГАРЯЧЕ', icon: <Flame className="w-3 h-3" /> },
    sale: { bg: 'from-emerald-500 to-teal-500', text: 'text-white', label: 'ЗНИЖКА', icon: <Percent className="w-3 h-3" /> },
    top: { bg: 'from-purple-500 to-violet-500', text: 'text-white', label: 'ТОП', icon: <Zap className="w-3 h-3" /> },
    new: { bg: 'from-sky-500 to-blue-500', text: 'text-white', label: 'НОВЕ', icon: <Tag className="w-3 h-3" /> },
  };
  const c = configs[type] || configs.hot;
  return (
    <motion.div
      animate={{ scale: [1, 1.08, 1] }}
      transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
      className={`absolute top-2 left-2 z-20 bg-gradient-to-r ${c.bg} ${c.text} text-[9px] font-black px-2 py-1 rounded-full shadow-lg flex items-center gap-1`}
    >
      {c.icon} {c.label}
    </motion.div>
  );
};



// ─── Info Tabs Content ──────────────────────────────────────
const InfoTabs = () => {
  const [activeTab, setActiveTab] = useState('delivery');

  const tabs = [
    { id: 'delivery', label: 'Доставка', icon: <TruckIcon className="w-4 h-4" />, color: 'purple' },
    { id: 'payment', label: 'Оплата', icon: <Wallet className="w-4 h-4" />, color: 'emerald' },
    { id: 'contacts', label: 'Контакти', icon: <Headphones className="w-4 h-4" />, color: 'sky' },
    { id: 'terms', label: 'Умови', icon: <FileText className="w-4 h-4" />, color: 'amber' },
  ];

  const colorMap: Record<string, { activeBg: string; activeText: string; ring: string }> = {
    purple: { activeBg: 'bg-purple-600', activeText: 'text-white', ring: 'ring-purple-200' },
    emerald: { activeBg: 'bg-emerald-600', activeText: 'text-white', ring: 'ring-emerald-200' },
    sky: { activeBg: 'bg-sky-600', activeText: 'text-white', ring: 'ring-sky-200' },
    amber: { activeBg: 'bg-amber-600', activeText: 'text-white', ring: 'ring-amber-200' },
  };

  return (
    <motion.section initial="hidden" animate="visible" variants={fadeInUp} className="mb-6">
      <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
        {/* Tab headers — vertical list */}
        <div className="flex flex-col divide-y">
          {tabs.map((tab) => {
            const c = colorMap[tab.color];
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center justify-between gap-2 px-4 py-3 text-xs font-bold transition-all ${
                  isActive ? `${c.activeBg} ${c.activeText}` : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  {tab.icon}
                  {tab.label}
                </span>
                <ChevronRight className={`h-4 w-4 transition-transform ${isActive ? 'rotate-90' : ''}`} />
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="p-5 border-t">
          <AnimatePresence mode="wait">
            {activeTab === 'delivery' && (
              <motion.div key="delivery" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-700">
                    <Truck className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-slate-900">Самовивіз з відділень перевізників</h4>
                    <p className="mt-1 text-xs text-slate-500 leading-5">Замовлення можна отримати у відділеннях «Укрпошта» та «Нова Пошта».</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-xl bg-purple-50/60 border border-purple-100 p-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-purple-900"><PackageCheck className="h-4 w-4 text-purple-600" /> Графік відправлень</div>
                    <p className="mt-2 text-xs text-slate-600">Пн-Сб</p>
                  </div>
                  <div className="rounded-xl bg-purple-50/60 border border-purple-100 p-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-purple-900"><MapPin className="h-4 w-4 text-purple-600" /> Вартість доставки</div>
                    <p className="mt-2 text-xs text-slate-600">Розраховується згідно з тарифом перевізника.</p>
                  </div>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                    <p className="text-xs leading-5 text-amber-900">
                      <span className="font-bold">При отриманні замовлення обов'язково перевіряйте наявність усіх товарів, зовнішній вигляд і комплектацію.</span>
                      <br />У разі пошкодження — відмовтеся та повідомте за телефоном 097-602-0714.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'payment' && (
              <motion.div key="payment" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-slate-900">Зручна оплата при отриманні</h4>
                    <p className="mt-1 text-xs text-slate-500">Доступні кілька способів оплати</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                    <h5 className="text-sm font-bold text-emerald-900">Готівка</h5>
                    <p className="mt-2 text-xs text-slate-600 leading-5">Оплата при отриманні у відділенні Нової Пошти або Укрпошти.</p>
                    <p className="mt-2 text-xs font-bold text-emerald-700">Комісія: відсутня</p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                    <h5 className="text-sm font-bold text-emerald-900">Накладений платіж</h5>
                    <p className="mt-2 text-xs text-slate-600 leading-5">Оплата при отриманні. Нова Пошта — 1.8%, Укрпошта — 2%.</p>
                    <p className="mt-2 text-xs font-bold text-emerald-700">Мін. комісія: 10 грн</p>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'contacts' && (
              <motion.div key="contacts" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-xl border bg-sky-50/50 border-sky-100 p-4 text-center">
                    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                      <Phone className="h-5 w-5" />
                    </div>
                    <h5 className="text-xs font-bold text-sky-900">Call-Center</h5>
                    <a href="tel:0976020714" className="mt-2 block text-lg font-black text-sky-700">097-602-0714</a>
                  </div>
                  <div className="rounded-xl border bg-sky-50/50 border-sky-100 p-4 text-center">
                    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                      <Mail className="h-5 w-5" />
                    </div>
                    <h5 className="text-xs font-bold text-sky-900">E-mail</h5>
                    <a href="mailto:dneprogorb777@gmail.com" className="mt-2 block text-sm font-bold text-sky-700 break-all">dneprogorb777@gmail.com</a>
                  </div>
                  <div className="rounded-xl border bg-sky-50/50 border-sky-100 p-4 text-center">
                    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                      <Clock className="h-5 w-5" />
                    </div>
                    <h5 className="text-xs font-bold text-sky-900">Графік роботи</h5>
                    <div className="mt-2 space-y-0.5 text-xs font-semibold text-slate-700">
                      <p>Пн-Пт: 08:00 - 21:00</p>
                      <p>Сб: 09:00 - 19:00</p>
                      <p>Нд: 09:00 - 18:00</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'terms' && (
              <motion.div key="terms" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <h5 className="text-sm font-bold text-amber-900 mb-2">Обмеження перевізників</h5>
                  <p className="text-xs text-slate-700 leading-5"><span className="font-bold">Укрпошта:</span> акумулятори, товари понад 70 см або більше 30 кг.</p>
                  <p className="text-xs text-slate-700 leading-5 mt-1"><span className="font-bold">Нова Пошта поштомат:</span> крупногабаритні товари більше 40х60х30 см або понад 20 кг.</p>
                </div>
                <div className="rounded-xl bg-slate-50 border p-4">
                  <h5 className="text-sm font-bold text-slate-900 mb-2">Крупногабаритні категорії</h5>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {oversizedCategories.slice(0, 12).map((cat) => (
                      <span key={cat} className="text-[10px] font-medium text-slate-600 bg-white border rounded-md px-2 py-1.5">{cat}</span>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-slate-500">Отримати замовлення необхідно протягом 5 днів з моменту прибуття.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.section>
  );
};

// ─── Promo Banner ───────────────────────────────────────────
const PromoBanner = () => (
  <motion.div
    initial={{ opacity: 0, y: -20 }}
    animate={{ opacity: 1, y: 0 }}
    className="bg-gradient-to-r from-purple-700 via-violet-600 to-purple-700 text-white py-2.5 px-4 relative overflow-hidden"
  >
    <motion.div
      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
      animate={{ x: ['-100%', '100%'] }}
      transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
    />
    <div className="relative z-10 flex items-center justify-center gap-2 text-xs font-semibold">
      <Zap className="w-4 h-4 text-yellow-300" />
      <span>Безкоштовна доставка при замовленні від 2000 ₴</span>
      <span className="hidden sm:inline text-purple-200">|</span>
      <span className="hidden sm:inline">Знижки до -40% на популярні товари</span>
    </div>
  </motion.div>
);

// ─── Hero (главная) ─────────────────────────────────────────
const Hero = ({ onBrowse }: { onBrowse: () => void }) => (
  <section className="relative overflow-hidden bg-gradient-to-br from-purple-700 via-violet-700 to-purple-900 text-white">
    {/* Декоративные пятна */}
    <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-orange-500/25 blur-3xl" />
    <div className="pointer-events-none absolute -bottom-28 -left-28 h-80 w-80 rounded-full bg-fuchsia-500/20 blur-3xl" />
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.07]"
      style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)', backgroundSize: '22px 22px' }}
    />

    <div className="relative mx-auto max-w-7xl px-4 py-12 sm:py-16 lg:py-20 grid lg:grid-cols-2 gap-10 items-center">
      <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 border border-white/20 px-3 py-1 text-xs font-semibold backdrop-blur">
          <Zap className="h-3.5 w-3.5 text-yellow-300" /> Понад 14 000 товарів у каталозі
        </span>
        <h1 className="mt-4 text-3xl sm:text-4xl lg:text-5xl font-black leading-[1.1] tracking-tight">
          Автоаксесуари і тюнінг <span className="text-orange-400">під твоє авто</span>
        </h1>
        <p className="mt-4 max-w-xl text-sm sm:text-base text-purple-100 leading-relaxed">
          Модельний підбір за маркою, поколінням і кузовом. Дефлектори, килимки, багажники, обвіси,
          тюнінг-оптика та все для комфорту, захисту й стайлінгу.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={onBrowse}
            className="bg-white text-purple-700 px-6 py-3 rounded-xl font-bold text-sm shadow-lg hover:bg-purple-50 transition flex items-center gap-2"
          >
            <Search className="h-4 w-4" /> Обрати категорію
          </motion.button>
          <a
            href="tel:0976020714"
            className="bg-white/10 border border-white/25 px-6 py-3 rounded-xl font-bold text-sm hover:bg-white/20 transition flex items-center gap-2 backdrop-blur"
          >
            <Phone className="h-4 w-4" /> 097-602-0714
          </a>
        </div>
        <div className="mt-8 grid grid-cols-3 gap-4 max-w-md">
          {[
            { n: '14 000+', l: 'товарів' },
            { n: '24', l: 'категорії' },
            { n: '1-3 дні', l: 'доставка' },
          ].map((s) => (
            <div key={s.l}>
              <div className="text-xl sm:text-2xl font-black">{s.n}</div>
              <div className="text-[11px] text-purple-200 uppercase tracking-wide">{s.l}</div>
            </div>
          ))}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="hidden lg:flex justify-center"
      >
        <div className="grid grid-cols-2 gap-4">
          {[
            { icon: <Truck className="h-7 w-7" />, t: 'Швидка доставка', d: '1-3 дні по Україні' },
            { icon: <Shield className="h-7 w-7" />, t: 'Гарантія якості', d: 'Перевірені товари' },
            { icon: <Headphones className="h-7 w-7" />, t: 'Підтримка 24/7', d: 'Завжди на зв’язку' },
            { icon: <Percent className="h-7 w-7" />, t: 'Знижки до 40%', d: 'Акції щотижня' },
          ].map((c, i) => (
            <motion.div
              key={i}
              whileHover={{ y: -6 }}
              className="bg-white/10 border border-white/20 rounded-2xl p-5 backdrop-blur w-44"
            >
              <div className="text-orange-300">{c.icon}</div>
              <div className="mt-3 text-sm font-bold">{c.t}</div>
              <div className="text-[11px] text-purple-200 mt-0.5">{c.d}</div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  </section>
);

// ─── Main App ───────────────────────────────────────────────
export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [directProduct, setDirectProduct] = useState<Product | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const navigate = useNavigate();
  const location = useLocation();
  // id товара берём из URL: /product/123 — у каждого товара своя ссылка для реклами
  const productMatch = location.pathname.match(/^\/product\/(\d+)/);
  const activeProductId = productMatch ? Number(productMatch[1]) : null;
  const setActiveProductId = (id: number | null) => {
    navigate(id == null ? '/' : `/product/${id}`);
  };
  const [linkCopied, setLinkCopied] = useState(false);

// Structured data для открытого товара
const activeProduct = products.find(p => p.id === activeProductId) ||
                      (directProduct?.id === activeProductId ? directProduct : null) ||
                      sampleProducts.find(p => p.id === activeProductId) ||
                      null;
useProductStructuredData(activeProduct);

const [selectedReviewImage, setSelectedReviewImage] = useState<string>(
  activeProduct?.images?.[0] || ''
);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Усі');
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const PRODUCTS_PER_PAGE = 18;
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [showAddedToast, setShowAddedToast] = useState<number | null>(null);

  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [orderName, setOrderName] = useState('');
  const [orderPhone, setOrderPhone] = useState('');
  const [orderAddress, setOrderAddress] = useState('');
  const [isSendingOrder, setIsSendingOrder] = useState(false);

  const [isAdminMode, setIsAdminMode] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState('Аксесуари');
  const [formPrice, setFormPrice] = useState('');
  const [formOldPrice, setFormOldPrice] = useState('');
  const [formImagesStr, setFormImagesStr] = useState('');
  const [formBrand, setFormBrand] = useState('');
  const [formCompatibility, setFormCompatibility] = useState('');
  const [formCondition, setFormCondition] = useState('Новий');
  const [formColor, setFormColor] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formBadge, setFormBadge] = useState<'hot' | 'sale' | 'top' | 'new' | undefined>(undefined);

  const [revAuthor, setRevAuthor] = useState('');
  const [revRating] = useState(5);
  const [revText, setRevText] = useState('');

  // ─── Data Loading ─────────────────────────────────────────
  useEffect(() => {
    fetchReviews();
  }, []);

  // Признак «есть активный фильтр» — показываем товары (а не главную)
  const isSearching = searchQuery.trim() !== '' && searchQuery.trim() !== ADMIN_PASSWORD;
  const hasFilter = isAdminMode || selectedCategory !== 'Усі' || isSearching;

  // Серверная пагинация: грузим только текущую страницу выбранного фильтра.
  // Каталог большой (десятки тысяч товаров) — грузить всё в браузер нельзя.
  const fetchProducts = async () => {
    setIsLoading(true);
    const start = (currentPage - 1) * PRODUCTS_PER_PAGE;
    let query = supabase.from('products').select('*', { count: 'exact' });
    if (isSearching) {
      query = query.ilike('name', `%${searchQuery.trim()}%`);
    } else {
      if (selectedCategory !== 'Усі') query = query.eq('category', selectedCategory);
      if (selectedSubcategory) query = query.eq('subcategory', selectedSubcategory);
    }
    const { data, count, error } = await query
      .order('id', { ascending: false })
      .range(start, start + PRODUCTS_PER_PAGE - 1);
    if (!error && data) {
      setProducts(data as Product[]);
      setTotalCount(count ?? data.length);
    } else {
      setProducts([]);
      setTotalCount(0);
    }
    setIsLoading(false);
  };

  // Перезагружаем при смене фильтра/страницы (поиск — с дебаунсом).
  useEffect(() => {
    if (!hasFilter) { setProducts([]); setTotalCount(0); setIsLoading(false); return; }
    const t = setTimeout(fetchProducts, isSearching ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory, selectedSubcategory, searchQuery, currentPage, isAdminMode]);

  const fetchReviews = async () => {
    const { data, error } = await supabase.from('reviews').select('*');
    if (!error && data) setReviews(data);
  };

  useEffect(() => {
    if (activeProductId) {
      const current = products.find(p => p.id === activeProductId);
      if (current && current.images && current.images.length > 0) {
        setSelectedReviewImage(current.images[0]);
      }
    }
  }, [activeProductId, products]);

  // Прокрутка вверх при смене товара (в т.ч. при заходе по прямой ссылке)
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeProductId]);

  // ─── Cart Logic ───────────────────────────────────────────
  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      return [...prev, { ...product, quantity: 1 }];
    });
    setShowAddedToast(product.id);
    setTimeout(() => setShowAddedToast(null), 1500);
  };

  const updateQuantity = (id: number, delta: number) => {
    setCart(prev => prev.map(item => item.id === id ? { ...item, quantity: item.quantity + delta } : item).filter(item => item.quantity > 0));
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  // ─── Search & Filter ──────────────────────────────────────
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim() === ADMIN_PASSWORD) {
      setIsAdminMode(true);
      setSearchQuery('');
      alert('Вхід в панель адміністратора виконано!');
    }
  };

  // Товары приходят уже отфильтрованными и постранично с сервера.
  const paginatedProducts = products;
  const totalPages = Math.max(1, Math.ceil(totalCount / PRODUCTS_PER_PAGE));

  // Подкатегории выбранной категории (для второго уровня фильтра)
  const subcategoriesForCategory = selectedCategory !== 'Усі' ? (catalogTree[selectedCategory] || []) : [];

  // Сброс на первую страницу при смене категории/подкатегории/поиска
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedCategory, selectedSubcategory, searchQuery]);

  // При смене категории сбрасываем выбранную подкатегорию
  useEffect(() => {
    setSelectedSubcategory(null);
  }, [selectedCategory]);

  // Показывать товары только когда выбрана категория, идёт поиск или включена админка.
  // На главной (категория «Усі», без поиска) вместо сетки товарів показываем опис магазину.
  const showProducts = hasFilter;

  // Догружаем одиночный товар, если открыт по прямой ссылке и его нет на текущей странице
  useEffect(() => {
    if (activeProductId == null) return;
    if (products.some(p => p.id === activeProductId)) return;
    if (directProduct?.id === activeProductId) return;
    supabase.from('products').select('*').eq('id', activeProductId).single()
      .then(({ data }) => { if (data) setDirectProduct(data as Product); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProductId, products]);

  const currentProduct = useMemo(
    () => products.find(p => p.id === activeProductId)
      || (directProduct?.id === activeProductId ? directProduct : null),
    [activeProductId, products, directProduct]
  );
  const currentProductReviews = useMemo(() => reviews.filter(r => r.product_id === activeProductId), [reviews, activeProductId]);

  // ─── Admin ────────────────────────────────────────────────
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName || !formPrice || !formImagesStr) {
      alert('Заповніть Назву, Ціну та Фото!');
      return;
    }
    const imagesArray = formImagesStr.split(',').map(s => s.trim()).filter(Boolean);
    const productData = {
      name: formName, category: formCategory, price: Number(formPrice),
      old_price: formOldPrice ? Number(formOldPrice) : null,
      images: imagesArray, brand: formBrand || null, compatibility: formCompatibility || null,
      condition: formCondition || null, color: formColor || null, description: formDescription || null,
      badge: formBadge || null,
    };
    if (editingProduct) {
      await supabase.from('products').update(productData).eq('id', editingProduct.id);
    } else {
      await supabase.from('products').insert([productData]);
    }
    resetForm();
    fetchProducts();
  };

  const handleEditClick = (e: React.MouseEvent, product: Product) => {
    e.stopPropagation();
    setEditingProduct(product);
    setFormName(product.name);
    setFormCategory(product.category);
    setFormPrice(product.price.toString());
    setFormOldPrice(product.old_price ? product.old_price.toString() : '');
    setFormImagesStr(product.images.join(', '));
    setFormBrand(product.brand || '');
    setFormCompatibility(product.compatibility || '');
    setFormCondition(product.condition || 'Новій');
    setFormColor(product.color || '');
    setFormDescription(product.description || '');
    setFormBadge(product.badge);
  };

  const handleDeleteProduct = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (window.confirm('Видалити цей товар назавжди?')) {
      await supabase.from('products').delete().eq('id', id);
      if (activeProductId === id) setActiveProductId(null);
      fetchProducts();
    }
  };

  const resetForm = () => {
    setEditingProduct(null);
    setFormName(''); setFormPrice(''); setFormOldPrice(''); setFormImagesStr('');
    setFormBrand(''); setFormCompatibility(''); setFormCondition('Новий'); setFormColor(''); setFormDescription('');
    setFormBadge(undefined);
  };

  // ─── Reviews ──────────────────────────────────────────────
  const handleAddReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revAuthor || !revText) { alert('Введіть ім\u2019я та текст відгуку!'); return; }
    const { error } = await supabase.from('reviews').insert([{
      product_id: activeProductId, author: revAuthor, rating: revRating,
      text: revText, date: new Date().toLocaleDateString('uk-UA'),
    }]);
    if (error) {
      alert('Не вдалося опублікувати відгук: ' + error.message);
      return;
    }
    setRevAuthor(''); setRevText('');
    fetchReviews();
  };

  // ─── Order ────────────────────────────────────────────────
  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderName.trim() || !orderPhone.trim() || !orderAddress.trim()) { alert('Заповніть усі поля!'); return; }
    if (cart.length === 0) { alert('Кошик порожній!'); return; }

    const itemsText = cart.map(item => `• ${item.name} — ${item.quantity} шт. x ${item.price} ₴ = ${item.price * item.quantity} ₴`).join('\n');
    const message = `🛒 *Нове замовлення з AUTOSHOP-MARKET*\n\n👤 Ім'я: ${orderName}\n📞 Телефон: ${orderPhone}\n📍 Адреса: ${orderAddress}\n\n*Товари:*\n${itemsText}\n\n💰 *Разом: ${cartTotal} ₴*`;

    setIsSendingOrder(true);
    try {
      const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'Markdown' }),
      });
      const data = await response.json();
      if (data.ok) {
        alert('Дякуємо! Ваше замовлення прийнято!');
        setCart([]); setOrderName(''); setOrderPhone(''); setOrderAddress('');
        setIsCheckoutOpen(false); setIsCartOpen(false);
      } else { alert('Помилка відправки. Спробуйте ще раз.'); }
    } catch {
      alert('Помилка відправки. Перевірте інтернет-зв\u2019єднання.');
    } finally { setIsSendingOrder(false); }
  };

  // ═══════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-[#f4f4f6] text-slate-800 font-sans antialiased">
      {/* Promo Banner */}
      <PromoBanner />

      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm backdrop-blur-md bg-white/95">
        <div className="mx-auto max-w-7xl px-3 py-2.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 sm:py-3">
          <div className="flex items-center justify-between gap-3">
            <motion.div onClick={() => { setActiveProductId(null); setSelectedCategory('Усі'); setSearchQuery(''); }} className="text-xl font-black text-purple-700 cursor-pointer tracking-tighter shrink-0 select-none" whileHover={{ scale: 1.02 }}>
              AUTO<span className="text-orange-500">SHOP</span>
            </motion.div>
            <div className="flex items-center gap-2 sm:hidden shrink-0">
              {isAdminMode && (
                <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={() => { setIsAdminMode(false); resetForm(); }} className="text-xs text-red-600 font-bold bg-red-50 px-2 py-1.5 rounded-lg border border-red-200">
                  Вихід
                </motion.button>
              )}
              <motion.button whileTap={{ scale: 0.95 }} onClick={() => setIsCartOpen(true)} className="flex items-center gap-1.5 bg-purple-600 text-white px-3 py-2 rounded-xl font-semibold text-xs hover:bg-purple-700 transition relative shadow-md">
                <ShoppingCart className="h-4 w-4" />
                {cartCount > 0 && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center">
                    {cartCount}
                  </motion.span>
                )}
              </motion.button>
            </div>
          </div>

          <form onSubmit={handleSearchSubmit} className="flex flex-1 max-w-xl items-center border border-slate-300 rounded-xl bg-slate-50 focus-within:border-purple-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-purple-100 transition-all">
            <input
              type="text" placeholder="Пошук товарів..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent py-2.5 px-3 text-sm outline-none text-slate-900"
            />
            <button type="submit" className="bg-purple-600 text-white text-sm px-4 py-2.5 rounded-r-xl font-semibold hover:bg-purple-700 transition-colors flex items-center gap-1 shrink-0">
              <Search className="h-4 w-4" />
              <span className="hidden sm:inline">Знайти</span>
            </button>
          </form>

          <div className="hidden sm:flex items-center gap-3 shrink-0">
            {isAdminMode && (
              <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={() => { setIsAdminMode(false); resetForm(); }} className="flex items-center gap-1 text-xs text-red-600 font-bold bg-red-50 px-3 py-2 rounded-lg border border-red-200 hover:bg-red-100 transition">
                Вихід
              </motion.button>
            )}
            <motion.button whileTap={{ scale: 0.95 }} onClick={() => setIsCartOpen(true)} className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2.5 rounded-xl font-semibold text-xs hover:bg-purple-700 transition relative shadow-md">
              <ShoppingCart className="h-4 w-4" />
              <span>Кошик</span>
              {cartCount > 0 && (
                <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center">
                  {cartCount}
                </motion.span>
              )}
            </motion.button>
          </div>
        </div>
      </header>

      {/* Added to cart toast */}
      <AnimatePresence>
        {showAddedToast !== null && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%' }}
            className="fixed bottom-20 sm:bottom-6 left-1/2 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 text-sm font-semibold"
          >
            <div className="bg-green-500 rounded-full p-0.5"><Plus className="h-3 w-3 text-white" /></div>
            Товар додано в кошик!
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admin Panel */}
      <AnimatePresence>
        {isAdminMode && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="bg-white border-b overflow-hidden">
            <div className="mx-auto max-w-4xl bg-slate-50 border border-slate-200 rounded-xl p-4 m-4">
              <h2 className="text-xs font-bold text-purple-900 uppercase tracking-wider mb-3">
                {editingProduct ? '📝 Редагування товару' : '☁️ Додати новий товар'}
              </h2>
              <form onSubmit={handleSaveProduct} className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="md:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Назва товару *</label>
                  <input type="text" value={formName} onChange={e => setFormName(e.target.value)} className="w-full p-2 border border-slate-300 rounded-lg bg-white outline-none focus:border-purple-500 transition" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Категорія</label>
                  <select value={formCategory} onChange={e => setFormCategory(e.target.value)} className="w-full p-2 border border-slate-300 rounded-lg bg-white outline-none h-[33px]">
                    {categories.filter(c => c.name !== 'Усі').map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Ціна (₴) *</label>
                  <input type="number" value={formPrice} onChange={e => setFormPrice(e.target.value)} className="w-full p-2 border border-slate-300 rounded-lg bg-white outline-none" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Стара ціна</label>
                  <input type="number" value={formOldPrice} onChange={e => setFormOldPrice(e.target.value)} className="w-full p-2 border border-slate-300 rounded-lg bg-white outline-none" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Бейдж</label>
                  <select value={formBadge || ''} onChange={e => setFormBadge(e.target.value as any || undefined)} className="w-full p-2 border border-slate-300 rounded-lg bg-white outline-none h-[33px]">
                    <option value="">Немає</option>
                    <option value="hot">Гаряче</option>
                    <option value="sale">Знижка</option>
                    <option value="top">Топ</option>
                    <option value="new">Нове</option>
                  </select>
                </div>
                <div className="md:col-span-3">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Фото (через кому) *</label>
                  <input type="text" value={formImagesStr} onChange={e => setFormImagesStr(e.target.value)} className="w-full p-2 border border-slate-300 rounded-lg bg-white outline-none" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Виробник</label>
                  <input type="text" value={formBrand} onChange={e => setFormBrand(e.target.value)} className="w-full p-2 border border-slate-300 rounded-lg bg-white outline-none" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Сумісність</label>
                  <input type="text" value={formCompatibility} onChange={e => setFormCompatibility(e.target.value)} className="w-full p-2 border border-slate-300 rounded-lg bg-white outline-none" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Колір</label>
                  <input type="text" value={formColor} onChange={e => setFormColor(e.target.value)} className="w-full p-2 border border-slate-300 rounded-lg bg-white outline-none" />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Опис</label>
                  <textarea rows={2} value={formDescription} onChange={e => setFormDescription(e.target.value)} className="w-full p-2 border border-slate-300 rounded-lg bg-white outline-none" />
                </div>
                <div className="md:col-span-3 flex justify-end gap-2">
                  {editingProduct && <button type="button" onClick={resetForm} className="bg-slate-300 py-1.5 px-4 rounded-lg hover:bg-slate-400 transition">Скасувати</button>}
                  <button type="submit" className="bg-purple-700 text-white py-1.5 px-6 rounded-lg hover:bg-purple-800 transition font-bold">
                    {editingProduct ? 'Оновити' : 'Зберегти'}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      {/* Полноэкранный спиннер только при прямом заходе по ссылке товара, пока грузится база */}
      {isLoading && productMatch ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
            <Zap className="h-8 w-8 text-purple-600" />
          </motion.div>
          <p className="text-sm font-semibold text-slate-500">Завантаження товарів...</p>
        </div>
      ) : !currentProduct ? (
        <>
          {/* Hero — только на главной */}
          {!showProducts && (
            <Hero onBrowse={() => document.getElementById('categories')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
          )}

          {/* Categories */}
          <div id="categories" className="bg-white border-b shadow-sm scroll-mt-20">
            <div className="mx-auto max-w-7xl px-3 sm:px-4 py-4 sm:py-5">
              <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-purple-600">Підбір за напрямком</p>
                </div>
                <p className="max-w-md text-xs text-slate-500">Обери розділ, щоб швидко знайти потрібні товари.</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.keys(catalogTree).map((catName) => {
                  const isActive = selectedCategory === catName;
                  return (
                    <motion.button
                      key={catName}
                      whileHover={{ scale: 1.04 }}
                      whileTap={{ scale: 0.96 }}
                      onClick={() => setSelectedCategory(catName)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                        isActive
                          ? 'bg-purple-600 text-white border-purple-600 shadow-md'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-purple-400 hover:text-purple-700'
                      }`}
                    >
                      {catName}
                    </motion.button>
                  );
                })}
              </div>

              {/* Підкатегорії обраної категорії */}
              {subcategoriesForCategory.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => setSelectedSubcategory(null)}
                    className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-all border ${
                      selectedSubcategory === null
                        ? 'bg-orange-500 text-white border-orange-500 shadow'
                        : 'bg-orange-50 text-orange-700 border-orange-200 hover:border-orange-400'
                    }`}
                  >
                    Усі
                  </motion.button>
                  {subcategoriesForCategory.map((sub) => {
                    const isActive = selectedSubcategory === sub;
                    return (
                      <motion.button
                        key={sub}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => setSelectedSubcategory(sub)}
                        className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-all border ${
                          isActive
                            ? 'bg-orange-500 text-white border-orange-500 shadow'
                            : 'bg-orange-50 text-orange-700 border-orange-200 hover:border-orange-400'
                        }`}
                      >
                        {sub}
                      </motion.button>
                    );
                  })}
                </div>
              )}

              {/* Автохімія підкатегорії */}
              <div className="mt-5 pt-5 border-t border-slate-100">
                <div className="mb-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-purple-600">Автохімія</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {categories.filter(c => chemistrySubcategoryNames.has(c.name)).map((cat) => {
                    const isActive = selectedCategory === cat.name;
                    return (
                      <motion.button
                        key={cat.name}
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={() => setSelectedCategory(cat.name)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                          isActive
                            ? 'bg-purple-600 text-white border-purple-600 shadow-md'
                            : 'bg-white text-slate-700 border-slate-200 hover:border-purple-400 hover:text-purple-700'
                        }`}
                      >
                        {cat.name}
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <main className="mx-auto max-w-7xl px-3 sm:px-4 py-4 sm:py-6">
            {/* Products Grid */}
            {showProducts && (isLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}>
                  <Zap className="h-8 w-8 text-purple-600" />
                </motion.div>
                <p className="text-sm font-semibold text-slate-500">Завантаження товарів...</p>
              </div>
            ) : paginatedProducts.length === 0 ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
                <PackageCheck className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                <p className="text-sm font-semibold text-slate-500">Товарів не знайдено</p>
                <p className="text-xs text-slate-400 mt-1">Спробуйте змінити категорію або пошуковий запит</p>
              </motion.div>
            ) : (
              <motion.div layout className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                <AnimatePresence>
                  {paginatedProducts.map((product, i) => (
                    <motion.div
                      key={product.id}
                      custom={i}
                      initial="hidden"
                      animate="visible"
                      exit={{ opacity: 0, scale: 0.9 }}
                      variants={fadeInUp}
                      layout
                      whileHover={{ y: -6, transition: { duration: 0.2 } }}
                      onClick={() => setActiveProductId(product.id)}
                      className="bg-white border rounded-2xl p-3 flex flex-col justify-between relative cursor-pointer hover:shadow-xl transition-shadow group"
                    >
                      {isAdminMode && (
                        <div className="absolute left-2 top-2 z-20 flex gap-1">
                          <motion.button whileTap={{ scale: 0.9 }} onClick={(e) => handleEditClick(e, product)} className="rounded-full bg-blue-500 p-1.5 text-white shadow-md hover:bg-blue-600"><Edit2 className="h-3 w-3" /></motion.button>
                          <motion.button whileTap={{ scale: 0.9 }} onClick={(e) => handleDeleteProduct(e, product.id)} className="rounded-full bg-red-500 p-1.5 text-white shadow-md hover:bg-red-600"><Trash2 className="h-3 w-3" /></motion.button>
                        </div>
                      )}

                      <DiscountBadge oldPrice={product.old_price} price={product.price} />
                      <ProductBadge type={product.badge} />

                      <div className="aspect-square w-full overflow-hidden rounded-xl bg-slate-50 flex items-center justify-center relative">
                        <img src={firstImg(product.images, product.category)} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" onError={imgError(product.category)} />
                        <motion.div
                          initial={{ opacity: 0 }}
                          whileHover={{ opacity: 1 }}
                          className="absolute inset-0 bg-purple-600/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <span className="bg-white/90 text-purple-700 text-[10px] font-bold px-3 py-1.5 rounded-full shadow-lg">Переглянути</span>
                        </motion.div>
                      </div>

                      <div className="mt-2 flex flex-col flex-grow justify-between">
                        <h3 className="text-xs text-slate-800 line-clamp-2 min-h-[32px] font-medium group-hover:text-purple-700 transition-colors">{product.name}</h3>
                        <div className="mt-1">
                          {product.old_price && (
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-slate-400 line-through">{product.old_price} ₴</span>
                              <span className="text-[10px] font-bold text-red-500">
                                -{Math.round(((product.old_price - product.price) / product.old_price) * 100)}%
                              </span>
                            </div>
                          )}
                          <span className="text-sm font-black text-slate-900">{product.price} ₴</span>
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            onClick={(e) => { e.stopPropagation(); addToCart(product); }}
                            className="mt-2 w-full bg-purple-600 text-white py-2 rounded-lg text-[11px] font-bold hover:bg-purple-700 transition flex items-center justify-center gap-1 min-h-[36px]"
                          >
                            <ShoppingCart className="w-3 h-3" /> Купити
                          </motion.button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            ))}

            {/* Pagination */}
            {showProducts && totalPages > 1 && (() => {
              const getPages = () => {
                if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
                const pages: (number | '...')[] = [];
                const addPage = (p: number) => { if (!pages.includes(p)) pages.push(p); };
                addPage(1);
                if (currentPage > 3) pages.push('...');
                for (let p = Math.max(2, currentPage - 1); p <= Math.min(totalPages - 1, currentPage + 1); p++) addPage(p);
                if (currentPage < totalPages - 2) pages.push('...');
                addPage(totalPages);
                return pages;
              };
              return (
                <div className="flex items-center justify-center gap-1.5 mt-8 flex-wrap">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="p-2 rounded-lg border bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition min-w-[36px] min-h-[36px] flex items-center justify-center"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  {getPages().map((page, i) =>
                    page === '...'
                      ? <span key={`ellipsis-${i}`} className="w-8 text-center text-slate-400 text-xs">…</span>
                      : (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page as number)}
                          className={`w-9 h-9 rounded-lg text-xs font-bold transition ${
                            currentPage === page
                              ? 'bg-purple-600 text-white'
                              : 'bg-white border text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {page}
                        </button>
                      )
                  )}
                  <button
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    className="p-2 rounded-lg border bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition min-w-[36px] min-h-[36px] flex items-center justify-center"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              );
            })()}

            {/* Trust badges */}
            <motion.section initial="hidden" whileInView="visible" variants={fadeIn} className="mt-10">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { icon: <Truck className="h-6 w-6 text-purple-600" />, title: 'Швидка доставка', desc: '1-3 дні по Україні' },
                  { icon: <Shield className="h-6 w-6 text-emerald-600" />, title: 'Гарантія якості', desc: 'Перевірені товари' },
                  { icon: <Headphones className="h-6 w-6 text-sky-600" />, title: 'Підтримка 24/7', desc: 'Завжди на зв\u2019язку' },
                  { icon: <Percent className="h-6 w-6 text-orange-600" />, title: 'Найкращі ціни', desc: 'Знижки та акції' },
                ].map((badge, i) => (
                  <motion.div key={i} custom={i} variants={fadeInUp} className="bg-white border rounded-xl p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-50">{badge.icon}</div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">{badge.title}</h4>
                      <p className="text-[10px] text-slate-500">{badge.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.section>

            {/* SEO Text Block — показываем только на главной */}
            {!showProducts && (
            <motion.section initial="hidden" whileInView="visible" variants={fadeIn} className="mt-10">
              <div className="bg-white border rounded-2xl p-6 sm:p-8 space-y-6 text-sm text-slate-600 leading-relaxed">

                <div>
                  <h2 className="text-lg font-black text-slate-900 mb-2">AUTOSHOP-MARKET — інтернет-магазин автоаксесуарів і тюнінгу</h2>
                  <p>AUTOSHOP-MARKET — це спеціалізований маркетплейс автоаксесуарів і тюнінгу, де підбір будується навколо конкретного автомобіля, а не навколо хаотичного каталогу. Тут важливо не просто купити аксесуари, а обрати рішення, яке справді підходить за кузовом, поколінням, рестайлінгом, базою, типом даху, кріпленнями та іншими параметрами, від яких залежить сумісність.</p>
                  <p className="mt-2">Ми зібрали модельні автоаксесуари та тюнінг для легкових автомобілів, кросоверів, SUV, пікапів, мікроавтобусів і комерційного транспорту. У фокусі AUTOSHOP-MARKET — не випадковий асортимент, а категорії, де правильний підбір має вирішальне значення: дефлектори, килимки, бризковики, рейлінги, поперечини, багажники на дах, автобокси, пороги, підніжки, решітки радіатора, обвіси, тюнінг-оптика, LED-рішення, декоративні елементи та аксесуари для салону.</p>
                </div>

                <div>
                  <h3 className="text-base font-black text-slate-900 mb-2">Головна відмінність AUTOSHOP-MARKET від звичайного магазину</h3>
                  <p>Головна відмінність полягає в тому, що тут важливий не лише сам товар, а й його посадка, сумісність і логіка вибору. Для одних категорій критичний кузов, для інших — покоління, дорестайлінг або рестайлінг, тип даху, довжина бази, форма арки, конфігурація салону або точки кріплення.</p>
                  <ul className="mt-3 space-y-1.5">
                    {[
                      'Модельний підбір — під конкретну марку, модель, рік, покоління та кузов.',
                      'Експертна консультація — допомагаємо зрозуміти, де є ризик помилки, а де вибір очевидний.',
                      'Релевантні категорії — без випадкового каталожного шуму.',
                      'Рішення під задачу — комфорт, захист, подорожі, стайлінг, робота, off-road.',
                      'Роздріб, опт і дропшипінг — для кінцевих клієнтів і партнерів.',
                    ].map((item, i) => (
                      <li key={i} className="flex gap-2"><span className="text-purple-500 font-bold shrink-0">—</span>{item}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="text-base font-black text-slate-900 mb-2">Що можна купити в AUTOSHOP-MARKET</h3>
                  <p>В каталозі зібрані популярні та практичні категорії автоаксесуарів і тюнінгу, в яких сумісність має реальне значення.</p>
                  <ul className="mt-3 space-y-1.5">
                    {[
                      'Дефлектори вікон і капота — комфорт, вентиляція, захист від потоку повітря і дрібного бруду.',
                      'EVA-килимки, гумові та текстильні — захист салону, чистота і простий догляд.',
                      'Рейлінги, поперечини, багажники на дах — перевезення вантажу, боксів, велосипедів і спорядження.',
                      "Автобокси та дорожні системи — додатковий об’єм для подорожей і щоденних задач.",
                      'Пороги та підніжки — зручність посадки, захист порогової зони та виразний зовнішній вигляд.',
                      'Бризковики — захист арок, дверей і кузова від бруду та каміння.',
                      'Решітки радіатора, спойлери, обвіси — стайлінг і зміна зовнішності авто.',
                      'Автосвітло, LED і тюнінг-оптика — краща видимість і сучасний вигляд.',
                      "Хром-накладки та декоративні елементи — акуратне оновлення екстер’єру.",
                    ].map((item, i) => (
                      <li key={i} className="flex gap-2"><span className="text-purple-500 font-bold shrink-0">—</span>{item}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="text-base font-black text-slate-900 mb-2">Чому при підборі автотюнінгу часто виникають помилки</h3>
                  <p>Одна й та сама модель автомобіля може мати різні кузови, покоління, рестайлінги, варіанти бази, типи даху та різні посадочні точки. Саме тому підбір не можна зводити до запиту рівня «мені потрібно щось на цю модель».</p>
                  <ul className="mt-3 space-y-1.5">
                    {[
                      'Одна модель може випускатися в кількох кузовах.',
                      'У межах одного року можуть перетинатися дорестайлінг і рестайлінг.',
                      'Зовні схожі деталі часто мають різні кріплення та геометрію.',
                      'Для дахових систем критичний тип даху та формат кріплення.',
                      'Універсальні рішення не завжди дають точну посадку та очікуваний результат.',
                    ].map((item, i) => (
                      <li key={i} className="flex gap-2"><span className="text-orange-500 font-bold shrink-0">!</span>{item}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="text-base font-black text-slate-900 mb-2">Для кого підходить AUTOSHOP-MARKET</h3>
                  <ul className="space-y-1.5">
                    {[
                      'Для власників авто — якщо потрібен правильний тюнінг або аксесуар без хаосу в підборі.',
                      'Для тих, хто цінує сумісність — коли важливо, щоб товар не просто був «для моделі», а реально підходив до конкретного авто.',
                      'Для тих, хто покращує авто з практичною метою — комфорт, захист, подорожі, функціональність і зовнішній вигляд.',
                      'Для магазинів, СТО, студій і партнерів — якщо потрібні оптові умови, дропшипінг і зрозумілий асортимент.',
                    ].map((item, i) => (
                      <li key={i} className="flex gap-2"><span className="text-purple-500 font-bold shrink-0">—</span>{item}</li>
                    ))}
                  </ul>
                </div>

              </div>
            </motion.section>
            )}

            {/* Info Tabs — внизу, під текстом опису */}
            <InfoTabs />

            {/* Footer */}
            <footer className="mt-10 border-t pt-6 pb-8 text-center">
              <div className="flex items-center justify-center gap-2 mb-3">
                <span className="text-lg font-black text-purple-700">AUTO<span className="text-orange-500">SHOP</span></span>
              </div>
              <p className="text-xs text-slate-500">AUTOSHOP-MARKET — ваш надійний автомобільний магазин</p>
              <div className="flex items-center justify-center gap-4 mt-3">
                <a href="tel:0976020714" className="text-xs text-slate-600 hover:text-purple-600 transition flex items-center gap-1"><Phone className="w-3 h-3" /> 097-602-0714</a>
                <a href="mailto:dneprogorb777@gmail.com" className="text-xs text-slate-600 hover:text-purple-600 transition flex items-center gap-1"><Mail className="w-3 h-3" /> Email</a>
              </div>
              <p className="text-[10px] text-slate-400 mt-4">© 2025 AUTOSHOP-MARKET. Всі права захищені.</p>
            </footer>
          </main>
        </>
      ) : (
        /* Product Detail Page */
        <main className="mx-auto max-w-7xl px-3 sm:px-4 py-4 sm:py-6">
          <motion.button
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            onClick={() => setActiveProductId(null)}
            className="flex items-center gap-2 text-xs font-semibold text-slate-600 bg-white border px-4 py-2 rounded-xl mb-6 hover:shadow-md transition"
          >
            <ArrowLeft className="h-4 w-4" /> Назад до каталогу
          </motion.button>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 bg-white border rounded-2xl p-3 sm:p-6 shadow-sm">
            <div className="lg:col-span-7 flex flex-col gap-3">
              <div className="flex gap-2 overflow-x-auto shrink-0 sm:hidden">
                {(currentProduct.images || []).map((img, index) => (
                  <motion.button
                    key={index}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setSelectedReviewImage(img)}
                    className={`w-12 h-12 border-2 rounded-lg p-0.5 transition shrink-0 ${selectedReviewImage === img ? 'border-purple-600' : 'border-slate-200'}`}
                  >
                    <img src={img} alt="" className="w-full h-full object-cover rounded-md" onError={imgError(currentProduct.category)} />
                  </motion.button>
                ))}
              </div>
              <div className="hidden sm:flex gap-3">
                <div className="flex flex-col gap-2 shrink-0">
                  {(currentProduct.images || []).map((img, index) => (
                    <motion.button
                      key={index}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setSelectedReviewImage(img)}
                      className={`w-14 h-14 border-2 rounded-xl p-0.5 transition ${selectedReviewImage === img ? 'border-purple-600' : 'border-slate-200'}`}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover rounded-lg" onError={imgError(currentProduct.category)} />
                    </motion.button>
                  ))}
                </div>
                <div className="flex-1 aspect-square bg-slate-50 rounded-xl overflow-hidden flex items-center justify-center max-h-[460px] relative">
                  {currentProduct.badge && <div className="absolute top-3 left-3 z-10"><ProductBadge type={currentProduct.badge} /></div>}
                  <DiscountBadge oldPrice={currentProduct.old_price} price={currentProduct.price} />
                  <motion.img key={selectedReviewImage} initial={{ opacity: 0 }} animate={{ opacity: 1 }} src={firstImg([selectedReviewImage].filter(Boolean), currentProduct.category) || firstImg(currentProduct.images, currentProduct.category)} alt="" className="w-full h-full object-contain" onError={imgError(currentProduct.category)} />
                </div>
              </div>
              <div className="sm:hidden aspect-square bg-slate-50 rounded-xl overflow-hidden flex items-center justify-center relative">
                {currentProduct.badge && <div className="absolute top-3 left-3 z-10"><ProductBadge type={currentProduct.badge} /></div>}
                <DiscountBadge oldPrice={currentProduct.old_price} price={currentProduct.price} />
                <motion.img key={selectedReviewImage} initial={{ opacity: 0 }} animate={{ opacity: 1 }} src={firstImg([selectedReviewImage].filter(Boolean), currentProduct.category) || firstImg(currentProduct.images, currentProduct.category)} alt="" className="w-full h-full object-contain" onError={imgError(currentProduct.category)} />
              </div>
            </div>

            <div className="lg:col-span-5 flex flex-col justify-between lg:pl-6">
              <div>
                <span className="inline-block bg-purple-50 text-purple-700 text-[10px] font-bold px-3 py-1 rounded-full mb-3">{currentProduct.category}</span>
                <h1 className="text-base sm:text-lg font-bold text-slate-900 leading-tight mb-3">{currentProduct.name}</h1>
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex text-amber-400">
                    {[...Array(5)].map((_, i) => <Star key={i} className={`h-4 w-4 ${i < 4 ? 'fill-current' : ''}`} />)}
                  </div>
                  <span className="text-xs text-slate-500">({currentProductReviews.length} відгуків)</span>
                </div>
                <div className="bg-gradient-to-br from-slate-50 to-purple-50/30 border border-purple-100 rounded-2xl p-5 mb-4">
                  <div className="flex items-baseline gap-3">
                    <span className="text-3xl font-black text-slate-900">{currentProduct.price} ₴</span>
                    {currentProduct.old_price && (
                      <>
                        <span className="text-sm text-slate-400 line-through">{currentProduct.old_price} ₴</span>
                        <span className="text-sm font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
                          -{Math.round(((currentProduct.old_price - currentProduct.price) / currentProduct.old_price) * 100)}%
                        </span>
                      </>
                    )}
                  </div>
                  {currentProduct.old_price && (
                    <p className="text-xs text-emerald-600 font-semibold mt-2 flex items-center gap-1">
                      <Percent className="w-3 h-3" /> Економія {currentProduct.old_price - currentProduct.price} ₴
                    </p>
                  )}
                </div>

                <div className="space-y-2 mb-4">
                  {currentProduct.brand && <div className="flex justify-between text-xs"><span className="text-slate-500">Виробник</span><span className="font-semibold">{currentProduct.brand}</span></div>}
                  {currentProduct.color && <div className="flex justify-between text-xs"><span className="text-slate-500">Колір</span><span className="font-semibold">{currentProduct.color}</span></div>}
                  {currentProduct.condition && <div className="flex justify-between text-xs"><span className="text-slate-500">Стан</span><span className="font-bold text-emerald-600">{currentProduct.condition}</span></div>}
                </div>
              </div>
              <div className="mt-2 space-y-2">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => addToCart(currentProduct)}
                  className="w-full bg-gradient-to-r from-purple-600 to-purple-700 text-white py-3 rounded-xl font-bold shadow-lg hover:shadow-xl transition flex items-center justify-center gap-2"
                >
                  <ShoppingCart className="h-5 w-5" /> Додати в кошик
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    const url = `${window.location.origin}/product/${currentProduct.id}`;
                    navigator.clipboard?.writeText(url).then(() => {
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 1800);
                    });
                  }}
                  className="w-full bg-white border border-purple-200 text-purple-700 py-2.5 rounded-xl font-semibold text-sm hover:bg-purple-50 transition flex items-center justify-center gap-2"
                >
                  {linkCopied
                    ? <><Check className="h-4 w-4 text-emerald-600" /> Посилання скопійовано!</>
                    : <><Link2 className="h-4 w-4" /> Скопіювати посилання на товар</>}
                </motion.button>
              </div>
            </div>
          </motion.div>

          {/* Characteristics & Reviews */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-6">
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="lg:col-span-7 bg-white border rounded-2xl p-6 space-y-4">
              <h3 className="text-sm font-bold border-b pb-2 flex items-center gap-2">
                <FileText className="w-4 h-4 text-purple-600" /> Характеристики
              </h3>
              <p className="text-xs text-slate-600 bg-purple-50/50 p-4 rounded-xl leading-6">{currentProduct.description || "Опис відсутній."}</p>
              <table className="w-full text-xs">
                <tbody className="divide-y">
                  <tr><td className="py-3 text-slate-400 w-1/3">Виробник</td><td className="py-3 text-slate-800 font-semibold">{currentProduct.brand || "—"}</td></tr>
                  <tr><td className="py-3 text-slate-400">Сумісність</td><td className="py-3 text-slate-600">{currentProduct.compatibility || "—"}</td></tr>
                  <tr><td className="py-3 text-slate-400">Стан</td><td className="py-3 text-emerald-600 font-bold">{currentProduct.condition || "—"}</td></tr>
                  <tr><td className="py-3 text-slate-400">Колір</td><td className="py-3 text-slate-800 font-medium">{currentProduct.color || "—"}</td></tr>
                </tbody>
              </table>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="lg:col-span-5 bg-white border rounded-2xl p-6 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold border-b pb-2 mb-4 flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-purple-600" /> Відгуки ({currentProductReviews.length})
                </h3>
                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                  {currentProductReviews.length === 0 ? (
                    <div className="text-center py-8">
                      <Star className="h-8 w-8 text-slate-200 mx-auto mb-2" />
                      <p className="text-xs text-slate-400">Ще немає відгуків. Будьте першим!</p>
                    </div>
                  ) : (
                    currentProductReviews.map((rev) => (
                      <motion.div key={rev.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-slate-50 border rounded-xl p-3 text-xs">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-bold text-slate-800">{rev.author}</span>
                          <span className="text-[10px] text-slate-400">{rev.date}</span>
                        </div>
                        <div className="flex text-amber-400 mb-1">{[...Array(rev.rating)].map((_, i) => <Star key={i} className="h-3 w-3 fill-current" />)}</div>
                        <p className="text-slate-600 leading-4">{rev.text}</p>
                      </motion.div>
                    ))
                  )}
                </div>
              </div>
              <form onSubmit={handleAddReview} className="border-t pt-4 space-y-2 text-xs mt-4">
                <input type="text" placeholder="Ваше ім\u2019я" value={revAuthor} onChange={e => setRevAuthor(e.target.value)} className="p-2.5 border rounded-lg w-full bg-white outline-none focus:border-purple-500 transition" />
                <textarea placeholder="Текст відгуку..." rows={2} value={revText} onChange={e => setRevText(e.target.value)} className="p-2.5 border rounded-lg w-full bg-white outline-none focus:border-purple-500 transition" />
                <motion.button whileTap={{ scale: 0.98 }} type="submit" className="w-full bg-purple-100 text-purple-700 py-2 rounded-lg font-bold hover:bg-purple-200 transition flex items-center justify-center gap-1">
                  <MessageCircle className="w-3 h-3" /> Опублікувати
                </motion.button>
              </form>
            </motion.div>
          </div>
        </main>
      )}

      {/* Cart Drawer */}
      <AnimatePresence>
        {isCartOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm">
            <div className="absolute inset-0" onClick={() => setIsCartOpen(false)} />
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 25, stiffness: 200 }} className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b px-6 py-4">
                <h2 className="text-base font-bold flex items-center gap-2"><ShoppingCart className="h-5 w-5 text-purple-600" /> Кошик</h2>
                <button onClick={() => setIsCartOpen(false)} className="text-slate-400 hover:text-slate-600 p-1"><X className="h-5 w-5" /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {cart.length === 0 ? (
                  <div className="text-center py-12">
                    <ShoppingCart className="h-12 w-12 text-slate-200 mx-auto mb-3" />
                    <p className="text-sm text-slate-400 font-semibold">Кошик порожній</p>
                    <p className="text-xs text-slate-300 mt-1">Додайте товари з каталогу</p>
                  </div>
                ) : (
                  <AnimatePresence>
                    {cart.map((item) => (
                      <motion.div key={item.id} layout initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -100 }} className="flex gap-4 border-b pb-4">
                        <img src={firstImg(item.images, item.category)} alt="" className="h-16 w-16 rounded-xl object-cover shadow-sm" onError={imgError(item.category)} />
                        <div className="flex flex-1 flex-col justify-between">
                          <h4 className="text-xs font-medium text-slate-800 line-clamp-2">{item.name}</h4>
                          <div className="flex items-center justify-between mt-2">
                            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
                              <motion.button whileTap={{ scale: 0.9 }} onClick={() => updateQuantity(item.id, -1)} className="min-w-[36px] min-h-[36px] flex items-center justify-center px-2 py-1.5 hover:bg-white rounded-md transition"><Minus className="h-3 w-3" /></motion.button>
                              <span className="text-xs font-bold w-5 text-center">{item.quantity}</span>
                              <motion.button whileTap={{ scale: 0.9 }} onClick={() => updateQuantity(item.id, 1)} className="min-w-[36px] min-h-[36px] flex items-center justify-center px-2 py-1.5 hover:bg-white rounded-md transition"><Plus className="h-3 w-3" /></motion.button>
                            </div>
                            <span className="text-sm font-black text-slate-900">{item.price * item.quantity} ₴</span>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
              </div>
              {cart.length > 0 && (
                <div className="border-t p-6 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] space-y-3 bg-slate-50">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Разом:</span>
                    <span className="text-xl font-black text-slate-900">{cartTotal} ₴</span>
                  </div>
                  <motion.button whileTap={{ scale: 0.98 }} onClick={() => setIsCheckoutOpen(true)} className="w-full bg-gradient-to-r from-purple-600 to-purple-700 text-white py-3 rounded-xl font-bold shadow-lg flex items-center justify-center gap-2">
                    Оформити замовлення <ChevronRight className="h-4 w-4" />
                  </motion.button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Checkout Modal */}
      <AnimatePresence>
        {isCheckoutOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
            <div className="absolute inset-0" onClick={() => !isSendingOrder && setIsCheckoutOpen(false)} />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 max-h-[90dvh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold">Оформлення замовлення</h2>
                <button onClick={() => setIsCheckoutOpen(false)} className="text-slate-400 hover:text-slate-600 p-1"><X className="h-5 w-5" /></button>
              </div>
              <form onSubmit={handleSubmitOrder} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Ваше ім'я *</label>
                  <input type="text" value={orderName} onChange={e => setOrderName(e.target.value)} placeholder="Іван Петренко" className="w-full p-2.5 border border-slate-300 rounded-xl bg-white outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100 text-sm transition" required />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Номер телефону *</label>
                  <input type="tel" value={orderPhone} onChange={e => setOrderPhone(e.target.value)} placeholder="+380 XX XXX XX XX" className="w-full p-2.5 border border-slate-300 rounded-xl bg-white outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100 text-sm transition" required />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Адреса доставки *</label>
                  <input type="text" value={orderAddress} onChange={e => setOrderAddress(e.target.value)} placeholder="м. Дніпро, відділення №1" className="w-full p-2.5 border border-slate-300 rounded-xl bg-white outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100 text-sm transition" required />
                </div>
                <div className="bg-slate-50 border rounded-xl p-3 text-xs space-y-1 max-h-32 overflow-y-auto">
                  {cart.map(item => (
                    <div key={item.id} className="flex justify-between py-0.5">
                      <span className="text-slate-600 line-clamp-1 pr-2">{item.name} x{item.quantity}</span>
                      <span className="font-semibold shrink-0">{item.price * item.quantity} ₴</span>
                    </div>
                  ))}
                  <div className="flex justify-between font-bold border-t pt-2 mt-1 text-sm">
                    <span>Разом:</span>
                    <span>{cartTotal} ₴</span>
                  </div>
                </div>
                <motion.button whileTap={{ scale: 0.98 }} type="submit" disabled={isSendingOrder} className="w-full bg-gradient-to-r from-purple-600 to-purple-700 text-white py-3 rounded-xl font-bold disabled:opacity-60 shadow-lg flex items-center justify-center gap-2">
                  {isSendingOrder ? <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}><Zap className="h-5 w-5" /></motion.div> : 'Підтвердити замовлення'}
                </motion.button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Vercel Web Analytics */}
      <Analytics />
    </div>
  );
}
