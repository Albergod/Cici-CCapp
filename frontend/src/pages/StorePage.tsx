import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Store } from '@/types';
import { api } from '@/services/api';
import { useAuth } from '@/stores/authStore';
import { ProductCard } from '@/components/ProductCard';
import { Loader2, Users, Package, MessageSquare, ArrowLeft, UserCheck, Lock } from 'lucide-react';

export function StorePage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [contactBlocked, setContactBlocked] = useState(false);

  useEffect(() => {
    if (slug) loadStore();
  }, [slug]);

  const loadStore = async () => {
    try {
      setLoading(true);
      const data = await api.stores.getBySlug(slug!);
      setStore(data);
      setFollowersCount(data.followersCount || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar tienda');
    } finally {
      setLoading(false);
    }
  };

  const handleFollow = async () => {
    if (!isAuthenticated || !store) {
      navigate('/login');
      return;
    }

    try {
      const result = await api.stores.follow(store.id);
      setFollowing(result.following);
      setFollowersCount((prev) => (result.following ? prev + 1 : prev - 1));
    } catch (err) {
      console.error('Error following store:', err);
    }
  };

  const handleContact = async () => {
    // Si la tienda explícitamente no tiene contacto disponible, avisamos sin llamar a la API.
    if (store && store.contactAvailable === false) {
      setContactBlocked(true);
      return;
    }

    if (!isAuthenticated || !store) {
      navigate('/login');
      return;
    }

    try {
      setContactBlocked(false);
      const conversation = await api.chat.openConversation(store.id);
      navigate(`/chat/${conversation.id}`);
    } catch (err: any) {
      // El backend devuelve code: 'SUBSCRIPTION_REQUIRED' cuando no hay contacto activo.
      if (err?.message?.includes('suscripción') || err?.message?.includes('contacto')) {
        setContactBlocked(true);
      } else {
        console.error('Error opening conversation:', err);
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen pt-16 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
      </div>
    );
  }

  if (error || !store) {
    return (
      <div className="min-h-screen pt-16 flex items-center justify-center">
        <div className="text-center card p-10">
          <p className="text-accent-500 font-medium">{error || 'Tienda no encontrada'}</p>
          <button onClick={() => navigate('/')} className="btn-primary mt-4">
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  const gradient = 'bg-gradient-to-br from-brand-600 via-brand-500 to-accent-500';

  return (
    <div className="min-h-screen pt-16">
      <div className={`relative h-48 md:h-60 ${gradient}`}>
        {store.bannerUrl && (
          <img src={store.bannerUrl} alt="" className="w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
        <button
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 p-2.5 rounded-full bg-white/85 hover:bg-white text-surface-700 shadow-soft transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
      </div>

      <div className="max-w-5xl mx-auto px-4">
        <div className="relative -mt-14 mb-8">
          <div className="flex flex-col md:flex-row items-start md:items-end gap-5">
            <div className="w-28 h-28 rounded-3xl bg-white shadow-lift flex items-center justify-center overflow-hidden ring-4 ring-white">
              {store.logoUrl ? (
                <img src={store.logoUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className={`w-full h-full ${gradient} flex items-center justify-center text-white text-4xl font-extrabold`}>
                  {store.name.charAt(0).toUpperCase()}
                </span>
              )}
            </div>

            <div className="flex-1">
              <h1 className="text-2xl md:text-3xl font-extrabold text-surface-900">
                {store.name}
              </h1>
              {store.description && (
                <p className="text-surface-500 mt-1.5 max-w-2xl">{store.description}</p>
              )}

              <div className="flex items-center flex-wrap gap-5 mt-4 text-sm text-surface-500 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-brand-500" />
                  <strong className="text-surface-900">{followersCount}</strong> seguidores
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Package className="w-4 h-4 text-brand-500" />
                  <strong className="text-surface-900">{store.products?.length || 0}</strong> productos
                </span>
                {store.plan !== 'FREE' && (
                  <span className="px-2.5 py-1 text-xs font-bold bg-brand-100 text-brand-700 rounded-full">
                    {store.plan}
                  </span>
                )}
              </div>
            </div>

            <div className="flex gap-2.5 w-full md:w-auto">
              <button
                onClick={handleFollow}
                className={`flex-1 md:flex-none inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] ${
                  following
                    ? 'bg-surface-100 text-surface-700 border border-surface-200 hover:bg-surface-200'
                    : 'bg-gradient-to-r from-brand-600 to-accent-500 hover:from-brand-700 hover:to-accent-600 text-white shadow-soft'
                }`}
              >
                <UserCheck className="w-4 h-4" />
                {following ? 'Siguiendo' : 'Seguir'}
              </button>
              <button
                onClick={handleContact}
                disabled={store.contactAvailable === false}
                className={`flex-1 md:flex-none inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] ${
                  store.contactAvailable === false
                    ? 'bg-surface-100 text-surface-400 border border-surface-200 cursor-not-allowed'
                    : 'text-surface-700 bg-white border border-surface-200 hover:bg-surface-50 shadow-soft'
                }`}
              >
                {store.contactAvailable === false ? (
                  <Lock className="w-4 h-4" />
                ) : (
                  <MessageSquare className="w-4 h-4 text-brand-500" />
                )}
                {store.contactAvailable === false ? 'Contacto cerrado' : 'Contactar'}
              </button>
            </div>
          </div>
        </div>

        <div className="mb-8">
          <h2 className="text-lg font-extrabold text-surface-900 mb-4">Productos</h2>
          {!store.products || store.products.length === 0 ? (
            <div className="text-center py-14 card p-10">
              <div className="w-14 h-14 rounded-2xl bg-surface-100 text-surface-400 flex items-center justify-center mx-auto mb-3">
                <Package className="w-7 h-7" />
              </div>
              <p className="text-surface-500">Esta tienda aún no tiene productos</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {store.products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onContact={store.contactAvailable === false ? undefined : handleContact}
                />
              ))}
            </div>
          )}
        </div>

        {store.contactAvailable === false && (
          <div className="mb-8 p-4 bg-surface-50 border border-surface-200 rounded-2xl flex items-center gap-3 text-sm text-surface-600">
            <Lock className="w-5 h-5 text-surface-400 shrink-0" />
            <span>
              Esta tienda no tiene el <strong>canal de contacto</strong> activo. El vendedor completó su periodo de prueba
              y necesita una <strong>suscripción de espacio</strong> para recibir mensajes.
            </span>
          </div>
        )}

        {contactBlocked && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-surface-900/50 backdrop-blur-sm" onClick={() => setContactBlocked(false)} />
            <div className="card p-6 w-full max-w-sm relative shadow-lift">
              <div className="w-12 h-12 rounded-2xl bg-surface-100 text-surface-500 flex items-center justify-center mx-auto mb-4">
                <Lock className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-extrabold text-surface-900 text-center mb-2">
                Contacto no disponible
              </h3>
              <p className="text-sm text-surface-600 text-center mb-5">
                Esta tienda ha terminado su periodo de prueba y necesita una suscripción de espacio para habilitar
                el contacto con clientes.
              </p>
              <button onClick={() => setContactBlocked(false)} className="btn-primary w-full">
                Entendido
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}