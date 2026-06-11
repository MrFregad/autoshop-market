import React, { useState, useMemo, useEffect } from 'react';
import { 
  Search, ShoppingCart, X, Plus, Minus, 
  Trash2, Settings, Edit2, ArrowLeft, Star 
} from 'lucide-react';
// Импортируем наше подключение к базе
import { supabase } from './supabaseClient';

interface Product {
  id: number;
  name: string;
  category: string;
  price: number;
  old_price?: number;
  images: string[];
  brand?: string;
  compatibility?: string;
  condition?: string;
  color?: string;
  description?: string;
}

interface CartItem extends Product {
  quantity: number;
}

interface Review {
  id: number;
  product_id: number;
  author: string;
  rating: number;
  text: string;
  date: string;
}

const categories = [
  { name: 'Все', image: "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=150&auto=format&fit=crop&q=60" },
  { name: 'Аксесуары', image: "https://images.unsplash.com/photo-1541807084-5c52b6b3adef?w=150&auto=format&fit=crop&q=60" },
  { name: 'Електроника', image: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=150&auto=format&fit=crop&q=60" },
  { name: 'Парфюмерия', image: "https://images.unsplash.com/photo-1541643600914-78b084683601?w=150&auto=format&fit=crop&q=60" },
  { name: 'Автохімія', image: "https://images.unsplash.com/photo-1607860108855-64acf2078ed9?w=150&auto=format&fit=crop&q=60" },
];

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Навигация
  const [activeProductId, setActiveProductId] = useState<number | null>(null);
  const [selectedReviewImage, setSelectedReviewImage] = useState<string>('');

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Все');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Админка
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState('Чохли та аксесуари');
  const [formPrice, setFormPrice] = useState('');
  const [formOldPrice, setFormOldPrice] = useState('');
  const [formImagesStr, setFormImagesStr] = useState(''); 
  const [formBrand, setFormBrand] = useState('');
  const [formCompatibility, setFormCompatibility] = useState('');
  const [formCondition, setFormCondition] = useState('Новий');
  const [formColor, setFormColor] = useState('');
  const [formDescription, setFormDescription] = useState('');

  // Отзывы
  const [revAuthor, setRevAuthor] = useState('');
  const [revRating, setRevRating] = useState(5);
  const [revText, setRevText] = useState('');

  const ADMIN_PASSWORD = 'admin123';

  // --- ЗАГРУЗКА ДАННЫХ ИЗ SUPABASE ---
  useEffect(() => {
    fetchProducts();
    fetchReviews();
  }, []);

  const fetchProducts = async () => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('id', { ascending: false });
    
    if (!error && data) setProducts(data);
    setIsLoading(false);
  };

  const fetchReviews = async () => {
    const { data, error } = await supabase.from('reviews').select('*');
    if (!error && data) setReviews(data);
  };

  useEffect(() => {
    if (activeProductId) {
      const current = products.find(p => p.id === activeProductId);
      if (current && current.images.length > 0) {
        setSelectedReviewImage(current.images[0]);
      }
    }
  }, [activeProductId, products]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim() === ADMIN_PASSWORD) {
      setIsAdminMode(true);
      setSearchQuery('');
      alert('Вхід в панель адміністратора виконано!');
    }
  };

  const filteredProducts = useMemo(() => {
    return products.filter(product => {
      const matchesCategory = selectedCategory === 'Все' || product.category === selectedCategory;
      if (searchQuery === ADMIN_PASSWORD) return matchesCategory;
      return matchesCategory && product.name.toLowerCase().includes(searchQuery.toLowerCase());
    });
  }, [products, searchQuery, selectedCategory]);

  const currentProduct = useMemo(() => {
    return products.find(p => p.id === activeProductId) || null;
  }, [activeProductId, products]);

  const currentProductReviews = useMemo(() => {
    return reviews.filter(r => r.product_id === activeProductId);
  }, [reviews, activeProductId]);

  // --- ЛОГИКА АДМИНКИ (СОХРАНЕНИЕ В SUPABASE) ---
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName || !formPrice || !formImagesStr) {
      alert('Заповніть Назву, Ціну та Фото!');
      return;
    }

    const imagesArray = formImagesStr.split(',').map(s => s.trim()).filter(Boolean);

    const productData = {
      name: formName,
      category: formCategory,
      price: Number(formPrice),
      old_price: formOldPrice ? Number(formOldPrice) : null,
      images: imagesArray,
      brand: formBrand || null,
      compatibility: formCompatibility || null,
      condition: formCondition || null,
      color: formColor || null,
      description: formDescription || null
    };

    if (editingProduct) {
      const { error } = await supabase
        .from('products')
        .update(productData)
        .eq('id', editingProduct.id);
      
      if (error) alert('Помилка оновлення: ' + error.message);
    } else {
      const { error } = await supabase
        .from('products')
        .insert([productData]);
      
      if (error) alert('Помилка додавання: ' + error.message);
    }

    resetForm();
    fetchProducts(); // Перезагружаем список из сети
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
    setFormCondition(product.condition || 'Новий');
    setFormColor(product.color || '');
    setFormDescription(product.description || '');
  };

  const handleDeleteProduct = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (window.confirm('Видалити цей товар з хмари назавжди?')) {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (!error) {
        if (activeProductId === id) setActiveProductId(null);
        fetchProducts();
      } else {
        alert('Помилка видалення: ' + error.message);
      }
    }
  };

  const resetForm = () => {
    setEditingProduct(null);
    setFormName(''); setFormPrice(''); setFormOldPrice(''); setFormImagesStr('');
    setFormBrand(''); setFormCompatibility(''); setFormCondition('Новий'); setFormColor(''); setFormDescription('');
  };

  // --- ДОБАВЛЕНИЕ ОТЗЫВА В SUPABASE ---
  const handleAddReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revAuthor || !revText) {
      alert('Будь ласка, введіть ім\'я та текст відгуку!');
      return;
    }

    const newReview = {
      product_id: activeProductId!,
      author: revAuthor,
      rating: revRating,
      text: revText,
      date: new Date().toLocaleDateString('uk-UA')
    };

    const { error } = await supabase.from('reviews').insert([newReview]);
    if (!error) {
      setRevAuthor('');
      setRevText('');
      fetchReviews(); // Обновляем отзывы с сервера
    } else {
      alert('Помилка відгуку: ' + error.message);
    }
  };

  // --- КОРЗИНА (ЛОКАЛЬНАЯ) ---
  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const updateQuantity = (id: number, delta: number) => {
    setCart(prev => prev.map(item => item.id === id ? { ...item, quantity: item.quantity + delta } : item).filter(item => item.quantity > 0));
  };

  return (
    <div className="min-h-screen bg-[#f9f9f9] text-slate-800 font-sans antialiased">
      {/* ШАПКА */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between gap-4">
          <div onClick={() => setActiveProductId(null)} className="text-xl font-black text-[#7a12df] cursor-pointer tracking-tighter shrink-0 select-none">
          AUTOSHOP-MARKET
          </div>

          <form onSubmit={handleSearchSubmit} className="flex flex-1 max-w-xl items-center border border-slate-300 rounded-lg bg-[#f4f4f4] focus-within:border-purple-600 focus-within:bg-white transition-all">
            <input
              type="text" placeholder="Искать..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent py-2 px-3 text-sm outline-none text-slate-900"
            />
            <button type="submit" className="bg-[#ebebeb] text-sm text-slate-700 px-4 py-2 rounded-r-lg border-l border-slate-300 hover:bg-slate-200 font-medium">Найти</button>
          </form>

          <div className="flex items-center gap-4 shrink-0">
            {isAdminMode && (
              <button onClick={() => { setIsAdminMode(false); resetForm(); }} className="flex items-center gap-1 text-xs text-red-600 font-bold bg-red-50 px-2 py-1.5 rounded-md border border-red-200 hover:bg-red-100">
                <span>Вихід з адмінки</span>
              </button>
            )}
            <button onClick={() => setIsCartOpen(true)} className="flex items-center gap-1.5 bg-purple-50 text-purple-700 px-3 py-2 rounded-lg font-semibold text-xs border border-purple-200 hover:bg-purple-100 relative">
              <span>Карзина ({cart.reduce((sum, item) => sum + item.quantity, 0)})</span>
            </button>
          </div>
        </div>
      </header>

      {/* АДМИНКА */}
      {isAdminMode && (
        <div className="bg-white border-b p-4 shadow-inner">
          <div className="mx-auto max-w-4xl bg-slate-50 border border-slate-200 rounded-xl p-4">
            <h2 className="text-xs font-bold text-purple-900 uppercase tracking-wider mb-3">
              {editingProduct ? '📝 Редагування в Supabase' : '☁️ Створення картки в хмару Supabase'}
            </h2>
            <form onSubmit={handleSaveProduct} className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="md:col-span-2">
                <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Назва товару *</label>
                <input type="text" value={formName} onChange={e => setFormName(e.target.value)} className="w-full p-2 border border-slate-300 rounded bg-white outline-none" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Категорія</label>
                <select value={formCategory} onChange={e => setFormCategory(e.target.value)} className="w-full p-2 border border-slate-300 rounded bg-white outline-none h-[33px]">
                  {categories.filter(c => c.name !== 'Все').map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Ціна (₴) *</label>
                <input type="number" value={formPrice} onChange={e => setFormPrice(e.target.value)} className="w-full p-2 border border-slate-300 rounded bg-white outline-none" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Стара ціна</label>
                <input type="number" value={formOldPrice} onChange={e => setFormOldPrice(e.target.value)} className="w-full p-2 border border-slate-300 rounded bg-white outline-none" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Виробник</label>
                <input type="text" value={formBrand} onChange={e => setFormBrand(e.target.value)} className="w-full p-2 border border-slate-300 rounded bg-white outline-none" />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Фото (через кому `,` ) *</label>
                <input type="text" value={formImagesStr} onChange={e => setFormImagesStr(e.target.value)} className="w-full p-2 border border-slate-300 rounded bg-white outline-none" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Сумісність</label>
                <input type="text" value={formCompatibility} onChange={e => setFormCompatibility(e.target.value)} className="w-full p-2 border border-slate-300 rounded bg-white outline-none" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Стан</label>
                <input type="text" value={formCondition} onChange={e => setFormCondition(e.target.value)} className="w-full p-2 border border-slate-300 rounded bg-white outline-none" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Колір</label>
                <input type="text" value={formColor} onChange={e => setFormColor(e.target.value)} className="w-full p-2 border border-slate-300 rounded bg-white outline-none" />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Детальний опис</label>
                <textarea rows={3} value={formDescription} onChange={e => setFormDescription(e.target.value)} className="w-full p-2 border border-slate-300 rounded bg-white outline-none" />
              </div>
              <div className="md:col-span-3 flex justify-end gap-2">
                {editingProduct && <button type="button" onClick={resetForm} className="bg-slate-300 py-1.5 px-4 rounded">Скасувати</button>}
                <button type="submit" className="bg-purple-700 text-white py-1.5 px-6 rounded">{editingProduct ? 'Оновити' : 'Зберегти в хмару'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* МАГАЗИН ИЛИ СТРАНИЦА ТОВАРА */}
      {isLoading ? (
        <div className="text-center py-20 text-sm font-semibold text-slate-500">Завантаження товарів з бази даних...</div>
      ) : !currentProduct ? (
        <>
          {/* СЕТКА КАТЕГОРИЙ */}
          <div className="bg-white border-b shadow-sm">
            <div className="mx-auto max-w-7xl px-4 py-3 flex overflow-x-auto gap-6 justify-center">
              {categories.map((cat) => (
                <button key={cat.name} onClick={() => setSelectedCategory(cat.name)} className="flex flex-col items-center gap-1 shrink-0">
                  <div className={`w-12 h-12 rounded-full overflow-hidden border p-0.5 ${selectedCategory === cat.name ? 'border-purple-600 ring-2 ring-purple-100' : 'border-slate-200'}`}>
                    <img src={cat.image} alt="" className="w-full h-full object-cover rounded-full" />
                  </div>
                  <span className="text-[10px] font-semibold text-slate-600">{cat.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* СПИСОК */}
          <main className="mx-auto max-w-7xl px-4 py-6">
            {filteredProducts.length === 0 ? (
              <div className="text-center text-xs text-slate-400 py-12">База даних порожня. Увійдіть в адмінку та додайте товари!</div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {filteredProducts.map((product) => (
                  <div key={product.id} onClick={() => setActiveProductId(product.id)} className="bg-white border rounded-xl p-3 flex flex-col justify-between relative cursor-pointer hover:shadow-md">
                    {isAdminMode && (
                      <div className="absolute left-2 top-2 z-20 flex gap-1">
                        <button onClick={(e) => handleEditClick(e, product)} className="rounded-full bg-blue-500 p-1 text-white"><Edit2 className="h-3 w-3" /></button>
                        <button onClick={(e) => handleDeleteProduct(e, product.id)} className="rounded-full bg-red-500 p-1 text-white"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    )}
                    <div className="aspect-square w-full overflow-hidden rounded-lg bg-slate-50 flex items-center justify-center">
                      <img src={product.images[0]} alt="" className="h-full w-full object-cover" />
                    </div>
                    <div className="mt-2 flex flex-col flex-grow justify-between">
                      <h3 className="text-xs text-slate-800 line-clamp-2 min-h-[32px]">{product.name}</h3>
                      <div>
                        {product.old_price && <span className="text-[10px] text-slate-400 line-through">{product.old_price} ₴</span>}
                        <span className="text-sm font-bold text-slate-900 block">{product.price} ₴</span>
                        <button onClick={(e) => { e.stopPropagation(); addToCart(product); }} className="mt-2 w-full bg-[#7a12df] text-white py-1 rounded text-[11px]">Купити</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </main>
        </>
      ) : (
        /* СТРАНИЦА ТОВАРА */
        <main className="mx-auto max-w-7xl px-4 py-6">
          <button onClick={() => setActiveProductId(null)} className="flex items-center gap-2 text-xs font-semibold text-slate-600 bg-white border px-3 py-1.5 rounded-lg mb-6">
            <ArrowLeft className="h-4 w-4" /> Назад до каталогу
          </button>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 bg-white border rounded-2xl p-6 shadow-sm">
            <div className="lg:col-span-7 flex flex-col sm:flex-row gap-3">
              <div className="flex sm:flex-col gap-2 overflow-x-auto shrink-0">
                {currentProduct.images.map((img, index) => (
                  <button key={index} onClick={() => setSelectedReviewImage(img)} className={`w-12 h-12 border rounded-md p-0.5 ${selectedReviewImage === img ? 'border-purple-600' : ''}`}>
                    <img src={img} alt="" className="w-full h-full object-cover rounded" />
                  </button>
                ))}
              </div>
              <div className="flex-1 aspect-square bg-slate-50 rounded-xl overflow-hidden flex items-center justify-center max-h-[460px]">
                <img src={selectedReviewImage || currentProduct.images[0]} alt="" className="w-full h-full object-contain" />
              </div>
            </div>

            <div className="lg:col-span-5 flex flex-col justify-between lg:pl-6">
              <div>
                <span className="inline-block bg-purple-50 text-purple-700 text-[10px] font-bold px-2 py-0.5 rounded mb-2">{currentProduct.category}</span>
                <h1 className="text-base sm:text-lg font-bold text-slate-900 leading-tight mb-2">{currentProduct.name}</h1>
                <div className="flex items-center gap-1.5 mb-4 text-xs text-slate-500">
                  <div className="flex text-amber-400"><Star className="h-4 w-4 fill-current" /></div>
                  <span>({currentProductReviews.length} відгуків)</span>
                </div>
                <div className="bg-slate-50 border rounded-xl p-4">
                  <span className="text-2xl font-black text-slate-900">{currentProduct.price} ₴</span>
                  {currentProduct.old_price && <span className="text-xs text-slate-400 line-through ml-2">{currentProduct.old_price} ₴</span>}
                </div>
              </div>
              <button onClick={() => addToCart(currentProduct)} className="w-full bg-[#7a12df] text-white py-2.5 rounded-xl font-bold mt-4">Додати в кошик</button>
            </div>
          </div>

          {/* ХАРАКТЕРИСТИКИ И ЖИВЫЕ ОТЗЫВЫ */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-6">
            <div className="lg:col-span-7 bg-white border rounded-2xl p-6 space-y-4">
              <h3 className="text-sm font-bold border-b pb-2">Характеристики</h3>
              <p className="text-xs text-slate-600 bg-purple-50/50 p-3 rounded-lg">{currentProduct.description || "Опис відсутній."}</p>
              <table className="w-full text-xs">
                <tbody>
                  <tr className="border-b"><td className="py-2 text-slate-400">Виробник</td><td className="py-2 text-slate-800 font-medium">{currentProduct.brand || "—"}</td></tr>
                  <tr className="border-b"><td className="py-2 text-slate-400">Сумісність</td><td className="py-2 text-slate-600 font-medium">{currentProduct.compatibility || "—"}</td></tr>
                  <tr className="border-b"><td className="py-2 text-slate-400">Стан</td><td className="py-2 text-emerald-600 font-bold">{currentProduct.condition || "—"}</td></tr>
                  <tr className="border-b"><td className="py-2 text-slate-400">Колір</td><td className="py-2 text-slate-800 font-medium">{currentProduct.color || "—"}</td></tr>
                </tbody>
              </table>
            </div>

            {/* КОММЕНТАРИИ СЕРВЕРА */}
            <div className="lg:col-span-5 bg-white border rounded-2xl p-6 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold border-b pb-2 mb-4">Відгуки покупців ({currentProductReviews.length})</h3>
                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                  {currentProductReviews.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-6">Ще немає відгуків. Будьте першим!</p>
                  ) : (
                    currentProductReviews.map((rev) => (
                      <div key={rev.id} className="bg-slate-50 border rounded-xl p-3 text-xs">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-bold">{rev.author}</span>
                          <span className="text-[10px] text-slate-400">{rev.date}</span>
                        </div>
                        <p className="text-slate-600">{rev.text}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <form onSubmit={handleAddReview} className="border-t pt-4 space-y-2 text-xs mt-4">
                <input type="text" placeholder="Ваше ім'я" value={revAuthor} onChange={e => setRevAuthor(e.target.value)} className="p-2 border rounded w-full bg-white outline-none" />
                <textarea placeholder="Текст відгуку..." rows={2} value={revText} onChange={e => setRevText(e.target.value)} className="p-2 border rounded w-full bg-white outline-none" />
                <button type="submit" className="w-full bg-purple-100 text-purple-700 py-1.5 rounded font-bold">Опублікувати на сайт</button>
              </form>
            </div>
          </div>
        </main>
      )}

      {/* МОДАЛКА КОРЗИНЫ */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={() => setIsCartOpen(false)} />
          <div className="relative flex h-full w-full max-w-md flex-col bg-white">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-base font-bold">Карзина заказов</h2>
              <button onClick={() => setIsCartOpen(false)} className="text-slate-400">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {cart.map((item) => (
                <div key={item.id} className="flex gap-4 border-b pb-4">
                  <img src={item.images[0]} alt="" className="h-14 w-14 rounded-lg object-cover" />
                  <div className="flex flex-1 flex-col justify-between">
                    <h4 className="text-xs font-medium text-slate-800 line-clamp-1">{item.name}</h4>
                    <div className="flex items-center justify-between mt-1">
                      <div className="flex items-center gap-1 bg-slate-100 rounded p-0.5">
                        <button onClick={() => updateQuantity(item.id, -1)} className="px-1.5">-</button>
                        <span className="text-xs font-bold">{item.quantity}</span>
                        <button onClick={() => updateQuantity(item.id, 1)} className="px-1.5">+</button>
                      </div>
                      <span className="text-xs font-bold">{item.price * item.quantity} ₴</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}