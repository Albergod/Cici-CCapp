import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Store } from '@/types';
import { api } from '@/services/api';
import { useAuth } from '@/stores/authStore';
import { useFollowsVersion } from '@/stores/followsStore';
import { ProductCard } from '@/components/ProductCard';
import { Loader2, Users, Package, MessageSquare, ArrowLeft, UserCheck, BadgeCheck, Share2, Check, Sparkles, Flag } from 'lucide-react';

export function StorePage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const follows = useFollowsVersion();
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [copied, setCopied] = useState(false);
  // Id con el ojito "Ampliar" activo (uno solo a la vez, salta de producto en producto).
  const [armedProductId, setArmedProductId] = useState<string | null>(null);

  useEffect(() => {
    if (slug) loadStore();
  }, [slug]);

  const loadStore = async () => {
    try {
      setLoading(true);
      const data = await api.stores.getBySlug(slug!);
      setStore(data);
      setFollowersCount(data.followersCount || 0);
      setFollowing(!!data.following);
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
      follows.notifyFollowsChanged();
    } catch (err) {
      console.error('Error following store:', err);
    }
  };

  const handleContact = async (productId?: string) => {
    if (!isAuthenticated || !store) {
      navigate('/login');
      return;
    }

    if (productId) {
      api.products.registerView(productId).catch(() => {});
    }

    try {
      const conversation = await api.chat.openConversation(store.id, productId);
      navigate(`/chat/${conversation.id}`);
    } catch (err) {
      console.error('Error opening conversation:', err);
    }
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/store/${store?.slug}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const [reportMsg, setReportMsg] = useState<string | null>(null);

  const handleReport = async () => {
    if (!isAuthenticated || !store) {
      navigate('/login');
      return;
    }
    const reason = window.prompt('¿Qué pasó? Cuéntanos brevemente para revisar la tienda:', '');
    if (!reason || reason.trim().length < 5) return;
    try {
      const result = await api.stores.report(store.id, reason.trim());
      setReportMsg(result.message);
      setTimeout(() => setReportMsg(null), 6000);
    } catch (err) {
      setReportMsg(err instanceof Error ? err.message : 'No se pudo enviar el reporte.');
      setTimeout(() => setReportMsg(null), 6000);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen pt-[7.5rem] md:pt-16 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
      </div>
    );
  }

  if (error || !store) {
    return (
      <div className="min-h-screen pt-[7.5rem] md:pt-16 flex items-center justify-center">
        <div className="text-center card p-10">
          <p className="text-accent-500 font-medium">{error || 'Tienda no encontrada'}</p>
          <button onClick={() => navigate('/')} className="btn-primary mt-4">
            Volver al inicio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-[7.5rem] md:pt-16">
      {/* ── Portada ─────────────────────────────────────────── */}
      <div className="relative h-56 md:h-72 overflow-hidden bg-gradient-to-br from-brand-700 via-brand-500 to-accent-500">
        {store.bannerUrl ? (
          <img src={store.bannerUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 20% 30%, #fff 0, transparent 45%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.6) 0, transparent 40%)' }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface-100 via-surface-100/20 to-black/20" />
        {!store.bannerUrl && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10rem] md:text-[14rem] font-display font-bold text-white/10 leading-none select-none">
              {store.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <button
          onClick={() => navigate(-1)}
          className="absolute top-4 left-4 p-2.5 rounded-full bg-white/90 backdrop-blur hover:bg-white text-surface-700 shadow-lift transition-all active:scale-95"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
      </div>

      {/* ── Cabecera de la tienda ───────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="relative -mt-14 mb-10">
          <div className="flex flex-col md:flex-row items-start md:items-end gap-5">
            <div className="relative shrink-0">
              <div className="absolute -inset-1.5 rounded-[1.9rem] bg-gradient-to-br from-brand-500 to-accent-500 opacity-70 blur-[6px]" />
              <div className="relative w-28 h-28 rounded-3xl bg-white shadow-lift flex items-center justify-center overflow-hidden ring-4 ring-white">
                {store.logoUrl ? (
                  <img src={store.logoUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="w-full h-full bg-gradient-to-br from-brand-600 to-accent-500 flex items-center justify-center text-white text-4xl font-display font-bold">
                    {store.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              {store.verified && (
                <span className="absolute -bottom-2 -right-2 inline-flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white ring-4 ring-white shadow-soft">
                  <BadgeCheck className="w-4 h-4" />
                </span>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap mt-3 md:mt-0">
                {store.plan !== 'FREE' && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gradient-to-r from-brand-600 to-accent-500 text-white text-[10px] font-bold uppercase tracking-wider shadow-soft">
                    <Sparkles className="w-3 h-3" />
                    {store.plan}
                  </span>
                )}
                <h1 className="font-display text-3xl md:text-4xl font-bold text-surface-900 tracking-tight flex items-center gap-2">
                  {store.name}
                  {store.verified && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
                      <BadgeCheck className="w-3.5 h-3.5" />
                      Verificada
                    </span>
                  )}
                </h1>
              </div>
              {store.description && (
                <p className="text-surface-500 mt-2 max-w-2xl text-[15px] leading-relaxed">
                  {store.description}
                </p>
              )}

              <div className="flex items-center gap-6 mt-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-brand-50 text-brand-600">
                    <Users className="w-4 h-4" />
                  </span>
                  <div>
                    <strong className="font-display text-lg font-bold text-surface-900 leading-none">{followersCount}</strong>
                    <span className="block text-xs text-surface-500 mt-0.5">seguidores</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-accent-50 text-accent-500">
                    <Package className="w-4 h-4" />
                  </span>
                  <div>
                    <strong className="font-display text-lg font-bold text-surface-900 leading-none">{store.products?.length || 0}</strong>
                    <span className="block text-xs text-surface-500 mt-0.5">productos</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2.5 w-full md:w-auto">
              <button
                onClick={handleFollow}
                className={`flex-1 md:flex-none inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98] ${
                  following
                    ? 'bg-surface-100 text-surface-700 border border-surface-200 hover:bg-surface-200'
                    : 'bg-gradient-to-r from-brand-600 to-accent-500 hover:from-brand-700 hover:to-accent-600 text-white shadow-lift'
                }`}
              >
                <UserCheck className="w-4 h-4" />
                {following ? 'Siguiendo' : 'Seguir'}
              </button>
              <button
                onClick={() => handleContact()}
                className="flex-1 md:flex-none inline-flex items-center justify-center gap-2 px-6 py-3 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98] text-surface-900 bg-white border border-surface-200 hover:border-brand-300 hover:shadow-soft"
              >
                <MessageSquare className="w-4 h-4 text-brand-500" />
                Contactar
              </button>
              <button
                onClick={handleShare}
                className="flex-1 md:flex-none inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98] text-surface-900 bg-white border border-surface-200 hover:border-surface-300 hover:shadow-soft"
                aria-label="Compartir tienda"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-emerald-500" />
                ) : (
                  <Share2 className="w-4 h-4 text-surface-500" />
                )}
              </button>
            </div>
          </div>

          {reportMsg && (
            <div className="mb-6 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-700">
              {reportMsg}
            </div>
          )}

          <div className="flex justify-end mt-2 mb-6 md:mt-0 md:-mt-6">
            <button
              onClick={handleReport}
              className="inline-flex items-center gap-1.5 text-xs text-surface-400 hover:text-red-500 transition-colors"
              title="Reportar esta tienda al equipo de moderación"
            >
              <Flag className="w-3.5 h-3.5" />
              Reportar tienda
            </button>
          </div>
        </div>

        {/* ── Productos ─────────────────────────────────────── */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display text-xl md:text-2xl font-bold text-surface-900 tracking-tight flex items-center gap-2.5">
              Productos
              <span className="inline-flex items-center justify-center min-w-[1.75rem] h-6 px-2 rounded-full bg-brand-100 text-brand-700 text-xs font-bold">
                {store.products?.length || 0}
              </span>
            </h2>
            {store.products && store.products.length > 0 && (
              <span className="hidden sm:block text-xs text-surface-400 font-medium">
                Toque un producto para consultar.
              </span>
            )}
          </div>

          {!store.products || store.products.length === 0 ? (
            <div className="text-center py-16 card p-10">
              <div className="w-14 h-14 rounded-2xl bg-surface-100 text-surface-400 flex items-center justify-center mx-auto mb-4">
                <Package className="w-7 h-7" />
              </div>
              <p className="font-display font-bold text-surface-700 mb-1">Aún no hay productos</p>
              <p className="text-surface-400 text-sm">Vuelve pronto, esta tienda está abriendo su vitrina.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {store.products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  businessType={store.businessType}
                  onContact={handleContact}
                  imageZoom
                  armedId={armedProductId}
                  onArm={setArmedProductId}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
