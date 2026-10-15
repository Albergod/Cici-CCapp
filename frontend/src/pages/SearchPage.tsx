import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '@/services/api';
import { Product } from '@/types';
import { ProductCard } from '@/components/ProductCard';
import { Loader2, SearchIcon } from 'lucide-react';

export function SearchPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [maxPrice, setMaxPrice] = useState('');
  const [sort, setSort] = useState('recent');
  const [onlyOffer, setOnlyOffer] = useState(false);

  useEffect(() => {
    if (query) {
      searchProducts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, maxPrice, sort, onlyOffer]);

  const searchProducts = async () => {
    try {
      setLoading(true);
      const data = await api.products.search(query, 20, {
        maxPrice: maxPrice ? Number(maxPrice) : undefined,
        sort,
        onOffer: onlyOffer || undefined,
      });
      setProducts(data);
    } catch (err) {
      console.error('Error searching products:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen pt-[7.5rem] md:pt-16">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-surface-900 leading-tight">
            Resultados para "{query}"
          </h1>
          <p className="text-surface-500 mt-1">
            {products.length} producto{products.length !== 1 ? 's' : ''} encontrado{products.length !== 1 ? 's' : ''}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <input
              type="number"
              min={0}
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value.replace(/\D/g, ''))}
              placeholder="Precio máx."
              className="input !w-32 !py-2 text-sm"
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="input !w-auto !py-2 text-sm"
              aria-label="Ordenar"
            >
              <option value="recent">Recientes</option>
              <option value="price_asc">Menor precio</option>
              <option value="price_desc">Mayor precio</option>
            </select>
            <button
              type="button"
              onClick={() => setOnlyOffer((v) => !v)}
              className={`px-3 py-2 rounded-xl text-xs font-bold transition-colors ${onlyOffer ? 'bg-accent-500 text-white' : 'bg-surface-100 text-surface-500 hover:bg-surface-200'}`}
            >
              Solo ofertas
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
          </div>
        ) : products.length === 0 ? (
          <div className="card p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-surface-100 text-surface-400 flex items-center justify-center mx-auto mb-4">
              <SearchIcon className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-bold text-surface-900">No se encontraron productos</h2>
            <p className="text-surface-500 mt-1">Intenta con otros términos de búsqueda</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map((product) => (
              <Link
                key={product.id}
                to={product.store ? `/store/${product.store.slug}` : `#`}
                className="block"
              >
                <ProductCard product={product} businessType={product.store?.businessType} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}