import { useRef, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Product } from '@/types';
import { attributesToTitledList } from '@/lib/categoryFields';
import { formatCOP } from '@/lib/format';
import { ChevronLeft, ChevronRight, Package } from 'lucide-react';

interface ProductCarouselProps {
  products: Product[];
  loading?: boolean;
}

export function ProductCarousel({ products, loading = false }: ProductCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useEffect(() => {
    updateArrows();
    window.addEventListener('resize', updateArrows);
    return () => window.removeEventListener('resize', updateArrows);
  }, [products]);

  const updateArrows = () => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 0);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  const scrollByCard = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const cardWidth = 260;
    el.scrollBy({ left: dir * cardWidth, behavior: 'smooth' });
  };

  const handleScroll = () => updateArrows();

  if (loading) {
    return (
      <div className="flex gap-4 overflow-hidden py-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="w-60 shrink-0 space-y-3">
            <div className="aspect-square rounded-2xl bg-surface-200 animate-pulse" />
            <div className="h-4 w-3/4 bg-surface-200 rounded animate-pulse" />
            <div className="h-4 w-1/2 bg-surface-200 rounded animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="text-center py-10 card p-8">
        <div className="w-12 h-12 rounded-2xl bg-surface-100 text-surface-400 flex items-center justify-center mx-auto mb-3">
          <Package className="w-6 h-6" />
        </div>
        <p className="text-surface-500">Aún no hay productos publicados</p>
      </div>
    );
  }

  return (
    <div className="relative group">
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex gap-5 overflow-x-auto scroll-smooth pb-2 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {products.map((product) => {
          const label = product.store?.name || 'Tienda';
          return (
            <Link
              key={product.id}
              to={product.store ? `/store/${product.store.slug}` : '#'}
              className="w-56 shrink-0 snap-start"
            >
              <div className="bg-white rounded-2xl overflow-hidden shadow-card hover:shadow-lift transition-all duration-300 border border-surface-200/60">
                <div className="relative aspect-square bg-surface-100 overflow-hidden">
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-surface-300">
                      <Package className="w-12 h-12" />
                    </div>
                  )}
                  {product.available === false && (
                    <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] flex items-center justify-center">
                      <span className="px-3 py-1.5 bg-accent-500 text-white text-xs font-semibold rounded-full">
                        No disponible
                      </span>
                    </div>
                  )}
                </div>
                <div className="p-3.5">
                  <p className="text-[11px] font-semibold text-brand-600 truncate">
                    {label}
                  </p>
                  <h3 className="font-bold text-surface-900 text-sm truncate mt-0.5">
                    {product.name}
                  </h3>
                  <p className="text-lg font-extrabold text-surface-900 mt-1">
                    {formatCOP(product.price)}
                  </p>
                  {attributesToTitledList(product.store?.businessType, product.attributes).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {attributesToTitledList(product.store?.businessType, product.attributes).map((c) => (
                        <span
                          key={c.key}
                          className="px-1.5 py-0.5 text-[10px] font-semibold bg-brand-50 text-brand-700 border border-brand-100 rounded-md"
                        >
                          {c.label}: {c.value}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {canLeft && (
        <button
          onClick={() => scrollByCard(-1)}
          aria-label="Anterior"
          className="absolute -left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white shadow-lift border border-surface-200 text-surface-700 hover:text-brand-600 hover:scale-105 transition-all opacity-0 group-hover:opacity-100"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
      )}
      {canRight && (
        <button
          onClick={() => scrollByCard(1)}
          aria-label="Siguiente"
          className="absolute -right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white shadow-lift border border-surface-200 text-surface-700 hover:text-brand-600 hover:scale-105 transition-all opacity-0 group-hover:opacity-100"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}