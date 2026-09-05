import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/stores/authStore';
import { api } from '@/services/api';
import { Store } from '@/types';
import { StoreRulesModal } from '@/components/StoreRulesModal';
import { SpacePlanModal, SpaceSelection } from '@/components/SpacePlanModal';
import { NequiInvoiceModal } from '@/components/NequiInvoiceModal';
import { SalesDashboard } from '@/components/SalesDashboard';
import { Loader2, StoreIcon, Plus, ExternalLink, X, Package, Users, LayoutDashboard, ShieldCheck, Clock, CreditCard, AlertTriangle } from 'lucide-react';

export function DashboardPage() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showSpaceModal, setShowSpaceModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [pendingCycle, setPendingCycle] = useState<'MONTHLY' | 'BI_MONTHLY' | undefined>(
    undefined
  );
  const [storeName, setStoreName] = useState('');
  const [storeDescription, setStoreDescription] = useState('');
  const [showProductForm, setShowProductForm] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [productName, setProductName] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [productPrice, setProductPrice] = useState('');
  const [productImageUrl, setProductImageUrl] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    loadUserStore();
  }, [isAuthenticated]);

  const loadUserStore = async () => {
    try {
      const stores = await api.stores.list(0, 100);
      const userStore = stores.find((s: Store) => s.ownerId === user?.id);
      if (userStore) {
        const detail = await api.stores.getBySlug(userStore.slug);
        setStore(detail);
      } else {
        setStore(null);
      }
    } catch (err) {
      console.error('Error loading store:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    try {
      const newStore = await api.stores.create({
        name: storeName,
        description: storeDescription || undefined,
        subscriptionCycle: pendingCycle,
      });
      setStore(newStore);
      setShowCreateForm(false);
      setPendingCycle(undefined);
    } catch (err) {
      console.error('Error creating store:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleSpaceSelect = (selection: SpaceSelection) => {
    setShowSpaceModal(false);
    if (selection.type === 'paid') {
      setPendingCycle(selection.cycle);
      setShowInvoiceModal(true);
    } else {
      setPendingCycle(undefined);
      setShowCreateForm(true);
    }
  };

  const handleInvoiceConfirm = () => {
    setShowInvoiceModal(false);
    setShowCreateForm(true);
  };

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!store) return;
    setFormError(null);
    const price = Number(productPrice);
    if (!productName.trim() || Number.isNaN(price) || price <= 0) {
      setFormError('Ingresa un nombre válido y un precio mayor a 0.');
      return;
    }

    setAddingProduct(true);
    try {
      const product = await api.products.create(store.id, {
        name: productName.trim(),
        description: productDescription.trim() || undefined,
        price,
        imageUrl: productImageUrl.trim() || undefined,
      });
      setStore((prev) =>
        prev ? { ...prev, products: [...(prev.products || []), product] } : prev
      );
      setShowProductForm(false);
      setProductName('');
      setProductDescription('');
      setProductPrice('');
      setProductImageUrl('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al crear producto');
    } finally {
      setAddingProduct(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen pt-16 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-16">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-r from-brand-600 to-accent-500 flex items-center justify-center shadow-soft">
            <LayoutDashboard className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-surface-900 leading-tight">Dashboard</h1>
            <p className="text-sm text-surface-500">Gestiona tu tienda y tus productos</p>
          </div>
        </div>

        {!store && !showCreateForm ? (
          <div className="card p-12 text-center">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand-100 to-accent-100 text-brand-600 flex items-center justify-center mx-auto mb-5">
              <StoreIcon className="w-10 h-10" />
            </div>
            <h2 className="text-xl font-extrabold text-surface-900 mb-2">Crea tu tienda</h2>
            <p className="text-surface-500 mb-8 max-w-md mx-auto">
              Comienza a vender tus productos en el centro comercial digital
            </p>
            <button onClick={() => setShowRulesModal(true)} className="btn-primary">
              <Plus className="w-4 h-4" />
              Crear Mi Tienda
            </button>
          </div>
        ) : showCreateForm ? (
          <div className="card p-6 md:p-8 max-w-xl mx-auto">
            <h2 className="text-xl font-extrabold text-surface-900 mb-6">Nueva Tienda</h2>
            <form onSubmit={handleCreateStore} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                  Nombre de la tienda
                </label>
                <input
                  type="text"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  required
                  minLength={2}
                  className="input"
                  placeholder="Mi Tienda Increíble"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                  Descripción (opcional)
                </label>
                <textarea
                  value={storeDescription}
                  onChange={(e) => setStoreDescription(e.target.value)}
                  rows={3}
                  className="input resize-none"
                  placeholder="Cuéntanos sobre tu tienda..."
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={creating} className="btn-primary flex-1">
                  {creating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creando...
                    </>
                  ) : (
                    'Crear Tienda'
                  )}
                </button>
                <button type="button" onClick={() => { setShowCreateForm(false); setPendingCycle(undefined); }} className="btn-ghost">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        ) : store ? (
          <div className="space-y-6">
            <div className="card p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-600 to-accent-500 flex items-center justify-center shrink-0 shadow-soft">
                    {store.logoUrl ? (
                      <img src={store.logoUrl} alt="" className="w-full h-full object-cover rounded-2xl" />
                    ) : (
                      <span className="text-white text-2xl font-extrabold">
                        {store.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div>
                    <h2 className="text-lg font-extrabold text-surface-900">{store.name}</h2>
                    {store.description && (
                      <p className="text-sm text-surface-500 mt-0.5 line-clamp-1">{store.description}</p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-surface-500 font-medium">
                      <span className="inline-flex items-center gap-1">
                        <Users className="w-3.5 h-3.5 text-brand-500" />
                        {store.followersCount || 0} seguidores
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Package className="w-3.5 h-3.5 text-brand-500" />
                        {store.products?.length || 0} productos
                      </span>
                      <span className="px-2 py-0.5 bg-brand-100 text-brand-700 rounded-full font-bold">
                        {store.plan}
                      </span>
                    </div>
                  </div>
                </div>
                <button onClick={() => navigate(`/store/${store.slug}`)} className="btn-ghost text-sm">
                  <ExternalLink className="w-4 h-4" />
                  Ver Tienda
                </button>
              </div>
            </div>

            <DashboardSubscription store={store} />

            <SalesDashboard store={store} />

            <div className="card p-6">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-extrabold text-surface-900">Productos</h3>
                <button
                  onClick={() => setShowProductForm((v) => !v)}
                  className={showProductForm ? 'btn-ghost text-sm' : 'btn-primary text-sm'}
                >
                  {showProductForm ? (
                    <X className="w-4 h-4" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  {showProductForm ? 'Cancelar' : 'Agregar Producto'}
                </button>
              </div>

              {showProductForm && (
                <form onSubmit={handleAddProduct} className="mb-6 p-5 bg-surface-50 rounded-2xl border border-surface-200 space-y-4">
                  {formError && (
                    <div className="p-3 bg-accent-50 border border-accent-200 rounded-xl text-sm text-accent-600">
                      {formError}
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                        Nombre del producto
                      </label>
                      <input
                        type="text"
                        value={productName}
                        onChange={(e) => setProductName(e.target.value)}
                        required
                        className="input"
                        placeholder="Ej: Camiseta premium"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                        Precio (USD)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={productPrice}
                        onChange={(e) => setProductPrice(e.target.value)}
                        required
                        className="input"
                        placeholder="19.99"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                      Descripción (opcional)
                    </label>
                    <textarea
                      value={productDescription}
                      onChange={(e) => setProductDescription(e.target.value)}
                      rows={2}
                      className="input resize-none"
                      placeholder="Describe tu producto..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                      URL de imagen (opcional)
                    </label>
                    <input
                      type="url"
                      value={productImageUrl}
                      onChange={(e) => setProductImageUrl(e.target.value)}
                      className="input"
                      placeholder="https://..."
                    />
                  </div>
                  <button type="submit" disabled={addingProduct} className="btn-primary">
                    {addingProduct ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Agregando...
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4" />
                        Publicar Producto
                      </>
                    )}
                  </button>
                </form>
              )}

              {!store.products || store.products.length === 0 ? (
                <div className="text-center py-12 text-surface-400">
                  <Package className="w-10 h-10 mx-auto mb-2 text-surface-300" />
                  Aún no tienes productos. ¡Agrega tu primer producto!
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {store.products.map((product) => (
                    <div
                      key={product.id}
                      className="flex items-center justify-between p-3 bg-surface-50 rounded-xl border border-surface-200"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {product.imageUrl ? (
                          <img
                            src={product.imageUrl}
                            alt=""
                            className="w-12 h-12 rounded-lg object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-brand-100 to-accent-100 flex items-center justify-center shrink-0">
                            <Package className="w-5 h-5 text-brand-500" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="font-bold text-surface-900 text-sm truncate">{product.name}</p>
                          <p className="text-sm text-surface-500 font-semibold">
                            ${typeof product.price === 'number'
                              ? product.price.toFixed(2)
                              : Number(product.price).toFixed(2)}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 px-2.5 py-1 text-xs font-bold rounded-full ${
                          product.available
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-accent-100 text-accent-700'
                        }`}
                      >
                        {product.available ? 'Disponible' : 'No disponible'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}

        <StoreRulesModal
          open={showRulesModal}
          onAccept={() => {
            setShowRulesModal(false);
            setShowSpaceModal(true);
          }}
          onClose={() => setShowRulesModal(false)}
        />

        <SpacePlanModal
          open={showSpaceModal}
          onSelect={handleSpaceSelect}
          onClose={() => setShowSpaceModal(false)}
        />

        <NequiInvoiceModal
          open={showInvoiceModal}
          cycle={pendingCycle ?? 'MONTHLY'}
          onConfirm={handleInvoiceConfirm}
          onClose={() => setShowInvoiceModal(false)}
        />
      </div>
    </div>
  );
}

function formatDaysLeft(ms: number | undefined): string {
  if (!ms) return '';
  const days = Math.max(0, Math.ceil((ms - Date.now()) / (24 * 60 * 60 * 1000)));
  return `${days} día${days !== 1 ? 's' : ''}`;
}

function DashboardSubscription({ store }: { store: Store }) {
  const status = store.subscriptionStatus ?? 'trial';
  const trialEndsAt = store.trialEndsAt;

  if (status === 'active') {
    return (
      <div className="card p-5 flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-surface-900">Suscripción activa</p>
          <p className="text-sm text-surface-600 mt-0.5">
            Tu espacio de venta está activo. El contacto con clientes está habilitado.
          </p>
          <span className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 text-xs font-bold bg-emerald-100 text-emerald-700 rounded-full">
            <CreditCard className="w-3.5 h-3.5" />
            Plan {store.plan}
          </span>
        </div>
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div className="card p-5 flex items-start gap-4 border-accent-200">
        <div className="w-11 h-11 rounded-xl bg-accent-100 text-accent-600 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-surface-900">Prueba finalizada</p>
          <p className="text-sm text-surface-600 mt-0.5">
            Tu periodo de prueba terminó. El contacto con clientes está desactivado.
          </p>
          <button
            onClick={() => navigateToStore(store.slug)}
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-gradient-to-r from-brand-600 to-accent-500 text-white rounded-full hover:from-brand-700 hover:to-accent-600 transition-all"
          >
            <CreditCard className="w-3.5 h-3.5" />
            Activar suscripción de espacio
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-5 flex items-start gap-4">
      <div className="w-11 h-11 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center shrink-0">
        <Clock className="w-5 h-5" />
      </div>
      <div className="flex-1">
        <p className="font-bold text-surface-900">Periodo de prueba gratis</p>
        <p className="text-sm text-surface-600 mt-0.5">
          Disfrutas de <strong>2 meses y 15 días</strong> de prueba. El contacto con clientes está disponible.
          {trialEndsAt && (
            <span className="font-semibold text-brand-700">
              {' '}Te quedan {formatDaysLeft(trialEndsAt)}.
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

// Necesita acceso a navigate; definimos un helper separado para evitar hooks en subcomponente.
function navigateToStore(slug: string) {
  window.location.href = `/store/${slug}`;
}