import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutGrid, ChevronRight, X,
  Lightbulb, CircleDot, SunMedium, SprayCan, Armchair, PackagePlus,
  Droplets, Wind, Cpu, Wrench, ShieldCheck, Mountain,
  Circle, Layers, Car, Grid3x3, Package, Sparkle, Shirt, Tag, Volume2, TreePine,
} from 'lucide-react';
import { catalogTree } from '../catalogTree';

const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'Автолампи': Lightbulb,
  'Автомобільні диски': CircleDot,
  'Автосвітло': SunMedium,
  'Автохімія': SprayCan,
  'Аксесуари для авто в салон': Armchair,
  'Багажники/Дуги на дах': PackagePlus,
  'Бризковики': Droplets,
  'Дефлектори': Wind,
  'Електроніка': Cpu,
  'Запчастини кузова': Wrench,
  'Захист днища': ShieldCheck,
  'Кенгурятники і підніжки': Mountain,
  'Килимки': LayoutGrid,
  'Ковпаки': Circle,
  'Листовий пластик (для тюнінгу)': Layers,
  'Обвіси': Car,
  'Тюнінг решітки': Grid3x3,
  'Універсальні автоаксесуари': Package,
  'Хром накладки': Sparkle,
  'Чохли': Shirt,
  'Шильдики': Tag,
  'Шумовіброізоляція': Volume2,
  'OffRoad аксесуари': TreePine,
};
const DEFAULT_ICON = Package;

interface CatalogMegaMenuProps {
  onSelect: (category: string, subcategory?: string) => void;
}

export const CatalogMegaMenu: React.FC<CatalogMegaMenuProps> = ({ onSelect }) => {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const categoryNames = Object.keys(catalogTree);
  const active = hovered || categoryNames[0];
  const ActiveIcon = CATEGORY_ICONS[active] || DEFAULT_ICON;
  const subcats = catalogTree[active] || [];

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) setHovered(null);
    else document.body.style.overflow = '';
  }, [open]);

  const pick = (category: string, subcategory?: string) => {
    onSelect(category, subcategory);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-bold shadow-md transition-all sm:px-4 ${
          open
            ? 'bg-orange-500 text-white shadow-orange-200'
            : 'bg-purple-600 text-white hover:bg-purple-700 shadow-purple-200'
        }`}
      >
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.2 }}>
          {open ? <X className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
        </motion.span>
        <span className="hidden md:inline">Каталог</span>
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[2px]"
              onClick={() => setOpen(false)}
            />

            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="absolute left-0 top-full z-50 mt-2 flex w-[92vw] max-w-3xl origin-top-left overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl ring-1 ring-black/5 sm:w-[600px] lg:w-[840px]"
            >
              {/* Left column — category list */}
              <div className="max-h-[72vh] w-[150px] shrink-0 overflow-y-auto overflow-x-hidden border-r border-slate-100 bg-gradient-to-b from-slate-50 to-white py-2 sm:w-[220px] lg:w-[260px]">
                {categoryNames.map((name) => {
                  const Icon = CATEGORY_ICONS[name] || DEFAULT_ICON;
                  const isActive = active === name;
                  return (
                    <button
                      key={name}
                      onMouseEnter={() => setHovered(name)}
                      onFocus={() => setHovered(name)}
                      onClick={() => (hovered === name ? pick(name) : setHovered(name))}
                      className={`relative flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[11.5px] font-semibold leading-tight transition-colors sm:px-4 sm:text-xs ${
                        isActive ? 'bg-white text-purple-700' : 'text-slate-600 hover:bg-white/80 hover:text-purple-700'
                      }`}
                    >
                      {isActive && (
                        <motion.span
                          layoutId="mega-menu-active-bar"
                          className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-gradient-to-b from-orange-400 to-purple-600"
                        />
                      )}
                      <span className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
                        <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-orange-500' : 'text-slate-400'}`} />
                        <span className="truncate">{name}</span>
                      </span>
                      <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${isActive ? 'translate-x-0.5 text-orange-500' : 'text-slate-300'}`} />
                    </button>
                  );
                })}
              </div>

              {/* Right panel — subcategories */}
              <div className="max-h-[72vh] min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-white p-4 sm:p-5">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={active}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-purple-700 text-white shadow-sm">
                          <ActiveIcon className="h-4.5 w-4.5" />
                        </div>
                        <h3 className="truncate text-sm font-black leading-tight text-slate-900 sm:text-base">{active}</h3>
                      </div>
                      <button
                        onClick={() => pick(active)}
                        className="flex shrink-0 items-center gap-1 rounded-full bg-purple-50 px-3 py-1.5 text-[11px] font-bold text-purple-700 transition-colors hover:bg-purple-100"
                      >
                        Всі товари <ChevronRight className="h-3 w-3" />
                      </button>
                    </div>
                    {subcats.length > 0 ? (
                      <div className="columns-1 gap-x-5 sm:columns-2 lg:columns-3">
                        {subcats.map((sub) => (
                          <button
                            key={sub}
                            onClick={() => pick(active, sub)}
                            title={sub}
                            className="block w-full break-inside-avoid-column truncate rounded-lg px-2 py-1.5 text-left text-xs text-slate-600 transition-colors hover:bg-purple-50 hover:text-purple-700"
                          >
                            {sub}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">Підкатегорій немає — перегляньте всі товари розділу.</p>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
