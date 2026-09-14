import { useEffect, useRef, useState } from 'react';
import { Store } from '@/types';
import { StoreCard } from '@/components/StoreCard';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 15;

interface StorePagerProps {
  stores: Store[];
  loading: boolean;
}

export function StorePager({ stores, loading }: StorePagerProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const pages: Store[][] = [];
  for (let i = 0; i < stores.length; i += PAGE_SIZE) {
    pages.push(stores.slice(i, i + PAGE_SIZE));
  }

  useEffect(() => {
    setActive(0);
    scrollerRef.current?.scrollTo({ left: 0 });
  }, [stores]);

  const goTo = (index: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(index, pages.length - 1));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' });
  };

  const handleScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const idx = Math.floor(el.scrollLeft / el.clientWidth);
    setActive(Math.max(0, Math.min(idx, pages.length - 1)));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="overflow-x-auto snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex">
          {pages.map((group, i) => (
            <div key={i} className="min-w-full snap-start">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {group.map((store) => (
                  <StoreCard key={store.id} store={store} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {pages.length > 1 && (
        <div className="flex items-center justify-center gap-4 mt-7">
          <button
            onClick={() => goTo(active - 1)}
            disabled={active === 0}
            aria-label="Página anterior"
            className="w-8 h-8 rounded-full flex items-center justify-center border border-surface-200 text-surface-500 hover:text-brand-600 hover:border-brand-400 transition-colors disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2">
            {pages.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                aria-label={`Ir a la página ${i + 1}`}
                className={`h-2.5 rounded-full transition-all duration-300 ${
                  i === active
                    ? 'w-7 bg-gradient-to-r from-brand-600 to-accent-500 shadow-soft'
                    : 'w-2.5 bg-surface-300 hover:bg-surface-400'
                }`}
              />
            ))}
          </div>

          <button
            onClick={() => goTo(active + 1)}
            disabled={active === pages.length - 1}
            aria-label="Página siguiente"
            className="w-8 h-8 rounded-full flex items-center justify-center border border-surface-200 text-surface-500 hover:text-brand-600 hover:border-brand-400 transition-colors disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}