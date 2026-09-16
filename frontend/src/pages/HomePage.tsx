import { useEffect, useState } from 'react';
import { Store, Product } from '@/types';
import { api } from '@/services/api';
import { StorePager } from '@/components/StorePager';
import { ProductCarousel } from '@/components/ProductCarousel';
import { TutorialModal } from '@/components/TutorialModal';
import { Loader2, StoreIcon, Sparkles, ShoppingBag, MessageSquare, ChevronRight, CircleHelp } from 'lucide-react';

export function HomePage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [tipo, setTipo] = useState<'productos' | 'belleza'>('productos');
  const [loading, setLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tutorialOpen, setTutorialOpen] = useState(false);

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    loadStores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo]);

  const loadStores = async () => {
    try {
      setLoading(true);
      const data = await api.stores.list(0, 50, tipo);
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
    <>
    <div className="min-h-screen pt-[7.5rem] md:pt-16">
      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="rounded-3xl bg-gradient-to-br from-brand-700 via-brand-500 to-accent-500 text-white p-10 md:p-14 text-center shadow-[0_20px_60px_-20px_rgba(147,51,234,0.5)] mb-12 relative overflow-hidden">
          <div className="absolute -top-16 -right-16 w-64 h-64 bg-white/10 rounded-full blur-2xl" />
          <div className="absolute -bottom-20 -left-10 w-72 h-72 bg-white/10 rounded-full blur-2xl" />
          <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.12) 0, transparent 35%)' }} />
          <div className="relative">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 text-xs font-semibold backdrop-blur-sm mb-4">
              <Sparkles className="w-3.5 h-3.5" />
              Plan gratis para empezar
            </span>
            <h1 className="font-display text-3xl md:text-5xl font-bold tracking-tight mb-3 leading-tight">
              Tu Centro Comercial Digital
            </h1>
            <p className="text-white/80 text-base md:text-lg max-w-2xl mx-auto">
              Descubre tiendas únicas, chatea directo con cada emprendedor y compra en minutos.
              ¿Tienes algo para vender? Abre tu propia tienda gratis hoy.
            </p>
          </div>
          <button
            onClick={() => setTutorialOpen(true)}
            className="absolute bottom-3 left-4 sm:bottom-4 sm:left-5 inline-flex items-center gap-1.5 text-xs font-semibold text-white/70 hover:text-white transition-colors"
          >
            <CircleHelp className="w-4 h-4" />
            ¿No sabes qué hacer? Toca aquí
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 md:gap-4 mb-12">
          {features.map((f) => (
            <div
              key={f.title}
              className="card p-3 md:p-5 flex flex-col items-center text-center gap-1.5 md:gap-2 hover:shadow-lift hover:-translate-y-0.5 transition-all"
            >
              <div className="w-9 h-9 md:w-11 md:h-11 rounded-xl bg-gradient-to-br from-brand-100 to-accent-100 text-brand-600 flex items-center justify-center shrink-0">
                <f.icon className="w-4 h-4 md:w-5 md:h-5" />
              </div>
              <div>
                <h3 className="font-display font-bold text-surface-900 text-xs md:text-base leading-tight">
                  {f.title}
                </h3>
                <p className="text-[10px] md:text-sm text-surface-500 mt-0.5 leading-tight">
                  {f.desc}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mb-12">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-display text-xl md:text-2xl font-bold text-surface-900 tracking-tight">Productos destacados</h2>
              <p className="text-sm text-surface-500">De las tiendas del centro comercial</p>
            </div>
          </div>
          <ProductCarousel products={products} loading={productsLoading} />
        </div>

        <div className="flex items-center justify-between mb-6">
          <h2 className="font-display text-xl md:text-2xl font-bold text-surface-900 tracking-tight">Tiendas destacadas</h2>
          <span className="text-xs text-surface-400 sm:hidden flex items-center gap-1">
            Desliza para ver más
            <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </div>

        <div className="flex items-center gap-2 mb-6 bg-surface-100 p-1.5 rounded-2xl w-fit max-w-full overflow-x-auto">
          {([
            { key: 'productos', label: 'Productos' },
            { key: 'belleza', label: 'Belleza y barbería' },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setTipo(t.key)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
                tipo === t.key
                  ? 'bg-white text-brand-600 shadow-sm'
                  : 'text-surface-500 hover:text-surface-800'
              }`}
            >
              {t.label}
            </button>
          ))}
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
          <StorePager stores={stores} loading={loading} />
        )}
      </div>
    </div>
    <TutorialModal open={tutorialOpen} onClose={() => setTutorialOpen(false)} />
    </>
  );
}