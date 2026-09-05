import { useEffect, useState } from 'react';
import { Store, Product } from '@/types';
import { api } from '@/services/api';
import { StoreCard } from '@/components/StoreCard';
import { ProductCarousel } from '@/components/ProductCarousel';
import { Loader2, StoreIcon, Sparkles, ShoppingBag, MessageSquare } from 'lucide-react';

export function HomePage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStores();
    loadProducts();
  }, []);

  const loadStores = async () => {
    try {
      setLoading(true);
      const data = await api.stores.list(0, 20);
      setStores(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar tiendas');
    } finally {
      setLoading(false);
    }
  };

  const loadProducts = async () => {
    try {
      setProductsLoading(true);
      const data = await api.products.list(20);
      setProducts(data);
    } catch (err) {
      console.error('Error al cargar productos:', err);
    } finally {
      setProductsLoading(false);
    }
  };

  const features = [
    { icon: ShoppingBag, title: 'Crea tu tienda', desc: 'Abre tu local digital gratis y comienza a vender' },
    { icon: MessageSquare, title: 'Contacto directo', desc: 'Chatea en tiempo real con tus clientes' },
    { icon: Sparkles, title: 'Descubre marcas', desc: 'Explora tiendas únicas y productos increíbles' },
  ];

  return (
    <div className="min-h-screen pt-16">
      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="rounded-3xl bg-gradient-to-br from-brand-600 via-brand-500 to-accent-500 text-white p-10 md:p-14 text-center shadow-lift mb-12 relative overflow-hidden">
          <div className="absolute -top-16 -right-16 w-64 h-64 bg-white/10 rounded-full blur-2xl" />
          <div className="absolute -bottom-20 -left-10 w-72 h-72 bg-white/10 rounded-full blur-2xl" />
          <div className="relative">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 text-xs font-semibold backdrop-blur-sm mb-4">
              <Sparkles className="w-3.5 h-3.5" />
              Plan gratis para empezar
            </span>
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight mb-3 leading-tight">
              Tu Centro Comercial Digital
            </h1>
            <p className="text-white/80 text-base md:text-lg max-w-2xl mx-auto">
              Descubre tiendas únicas, conecta con emprendedores y encuentra productos increíbles
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
          {features.map((f) => (
            <div key={f.title} className="card p-5 flex items-start gap-4 hover:shadow-lift transition-all">
              <div className="w-11 h-11 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center shrink-0">
                <f.icon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-surface-900">{f.title}</h3>
                <p className="text-sm text-surface-500 mt-0.5">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mb-12">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-xl font-extrabold text-surface-900">Productos destacados</h2>
              <p className="text-sm text-surface-500">De las tiendas del centro comercial</p>
            </div>
          </div>
          <ProductCarousel products={products} loading={productsLoading} />
        </div>

        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-extrabold text-surface-900">Tiendas destacadas</h2>
          <span className="text-sm text-surface-400">Explora lo nuevo</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center py-20 card p-10">
            <p className="text-accent-500">{error}</p>
            <button onClick={loadStores} className="btn-primary mt-4">
              Reintentar
            </button>
          </div>
        ) : stores.length === 0 ? (
          <div className="text-center py-16 card p-10">
            <div className="w-16 h-16 rounded-2xl bg-brand-100 text-brand-500 flex items-center justify-center mx-auto mb-4">
              <StoreIcon className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-bold text-surface-900">No hay tiendas aún</h2>
            <p className="text-surface-500 mt-1">Sé el primero en crear tu tienda digital</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {stores.map((store) => (
              <StoreCard key={store.id} store={store} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}