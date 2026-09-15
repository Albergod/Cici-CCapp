import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/stores/authStore';
import { api } from '@/services/api';
import { Store, Product } from '@/types';
import { StoreRulesModal } from '@/components/StoreRulesModal';
import { SpacePlanModal, SpaceSelection } from '@/components/SpacePlanModal';
import { UpgradeSpaceModal } from '@/components/UpgradeSpaceModal';
import { PremiumUnlockedModal } from '@/components/PremiumUnlockedModal';
import { PaymentResultModal, PaymentResultState } from '@/components/PaymentResultModal';
import { SalesDashboard } from '@/components/SalesDashboard';
import { PrestigeCard } from '@/components/PrestigeCard';
import { BeautyServicesPanel } from '@/components/BeautyServicesPanel';
import { ShareStoreCard } from '@/components/ShareStoreCard';
import { fieldsFor, attributesToTitledList } from '@/lib/categoryFields';
import { formatCOP } from '@/lib/format';
import { Loader2, StoreIcon, Plus, ExternalLink, X, Package, Users, LayoutDashboard, ShieldCheck, Clock, CreditCard, AlertTriangle, BadgeCheck, Pencil, Image as ImageIcon, Palette, Upload, Settings2, ChevronDown, ChevronUp, Bot, CheckCircle2, TrendingUp } from 'lucide-react';

// Datos de la tienda por crear, guardados mientras se paga. Sobreviven al
// redirect de Mercado Pago para que la tienda se cree recién cuando el pago es
// confirmado (jamás se crea una tienda "fantasma" si el pago se cancela).
const PENDING_STORE_KEY = 'cc-pending-store-draft';

type StoreBusinessType = 'ROPA' | 'CALZADO' | 'ACCESORIOS' | 'HOGAR' | 'ALIMENTOS' | 'SERVICIOS' | 'BELLEZA' | 'OTRO';

type StoreDraft = {
  name: string;
  description?: string;
  businessType: StoreBusinessType;
  schedule?: {
    openTime: string;
    closeTime: string;
    lunchStart: string;
    lunchEnd: string;
    workingDays: number[];
    bookingHorizonDays: number;
    timezone: string;
  };
};

function readStoreDraft(): StoreDraft | null {
  try {
    const raw = sessionStorage.getItem(PENDING_STORE_KEY);
    return raw ? (JSON.parse(raw) as StoreDraft) : null;
  } catch {
    return null;
  }
}

export function DashboardPage() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [showSpaceModal, setShowSpaceModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPremiumUnlocked, setShowPremiumUnlocked] = useState(false);
  const [unlockedPlan, setUnlockedPlan] = useState<'PRO' | 'BUSINESS'>('PRO');
  const [unlockedCycle, setUnlockedCycle] = useState<'MONTHLY' | 'BI_MONTHLY'>('MONTHLY');
  const [pendingCreatePlan, setPendingCreatePlan] = useState<SpaceSelection | null>(null);
  const [paymentResult, setPaymentResult] = useState<PaymentResultState>(null);
  const [storeName, setStoreName] = useState('');
  const [storeDescription, setStoreDescription] = useState('');
  const [storeBusinessType, setStoreBusinessType] = useState<StoreBusinessType>('OTRO');
  const [schedule, setSchedule] = useState({
    openTime: '08:00',
    closeTime: '21:00',
    lunchStart: '12:00',
    lunchEnd: '13:00',
    workingDays: [1, 2, 3, 4, 5, 6],
    bookingHorizonDays: 30,
    timezone: 'America/Bogota',
  });
  const [showProductForm, setShowProductForm] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [productName, setProductName] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [productPrice, setProductPrice] = useState('');
  const [productStock, setProductStock] = useState('');
  const [productImageUrl, setProductImageUrl] = useState('');
  const [productAttributes, setProductAttributes] = useState<Record<string, string | number | boolean>>({});
  const [uploadingImage, setUploadingImage] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [savingStore, setSavingStore] = useState(false);
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [editStoreName, setEditStoreName] = useState('');
  const [editStoreDescription, setEditStoreDescription] = useState('');
  const [editLogoUrl, setEditLogoUrl] = useState('');
  const [editBannerUrl, setEditBannerUrl] = useState('');
  const [editWhatsapp, setEditWhatsapp] = useState('');

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    loadUserStore();
  }, [isAuthenticated]);

  // Retorno del checkout de Mercado Pago: la URL llega con collection_id y
  // collection_status. Verificamos el pago contra el backend (que lo confirma
  // contra Mercado Pago) y manejamos approved / pending / failure.
  useEffect(() => {
    if (!isAuthenticated) return;
    const paymentId = searchParams.get('collection_id') || searchParams.get('payment_id');
    if (!paymentId) return;

    (async () => {
      const result = await api.payments.status(paymentId).catch(() => null);
      const cleanParams = new URLSearchParams(searchParams);
      cleanParams.delete('collection_id');
      cleanParams.delete('payment_id');
      cleanParams.delete('collection_status');
      cleanParams.delete('status');
      cleanParams.delete('external_reference');
      cleanParams.delete('preference_id');
      cleanParams.delete('merchant_order_id');
      cleanParams.delete('payment_type');
      setSearchParams(cleanParams, { replace: true });

      if (!result) {
        setPaymentResult({ kind: 'failure', reason: 'not_found' });
        return;
      }
      if (result.status === 'approved') {
        setUnlockedPlan(result.plan ?? 'PRO');
        setUnlockedCycle(result.cycle ?? 'MONTHLY');
        // Si se pagó sin tienda, crearla YA (el backend le aplica el plan).
        (async () => {
          const hasDraft = !!readStoreDraft();
          const ok = hasDraft ? await finalizePaidStore() : true;
          if (ok) {
            setPaymentResult({ kind: 'success', plan: result.plan ?? 'PRO', cycle: result.cycle ?? 'MONTHLY' });
          }
          loadUserStore();
        })();
      } else if (result.status === 'pending' || result.status === 'in_process') {
        setPaymentResult({ kind: 'pending' });
      } else {
        setPaymentResult({ kind: 'failure', reason: result.detail ?? result.status });
      }
    })();
  }, [isAuthenticated, searchParams]);

  const retryPayment = () => {
    // Llama de nuevo al último paymentId en la URL o limpia para reabrir checkout.
    const paymentId = searchParams.get('collection_id') || searchParams.get('payment_id');
    if (!paymentId) {
      setPaymentResult(null);
      setShowUpgradeModal(true);
      return;
    }
    (async () => {
      const result = await api.payments.status(paymentId).catch(() => null);
      if (result?.status === 'approved') {
        setUnlockedPlan(result.plan ?? 'PRO');
        setUnlockedCycle(result.cycle ?? 'MONTHLY');
        (async () => {
          const hasDraft = !!readStoreDraft();
          const ok = hasDraft ? await finalizePaidStore() : true;
          if (ok) {
            setPaymentResult({ kind: 'success', plan: result.plan ?? 'PRO', cycle: result.cycle ?? 'MONTHLY' });
          }
          loadUserStore();
        })();
      } else {
        setPaymentResult({ kind: 'pending' });
      }
    })();
  };

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
      // Flujo de pago: el comerciante eligió un plan de pago. NO se crea la
      // tienda todavía (nada de tiendas fantasma). Guardamos los datos y vamos
      // directo al pago; la tienda se crea SOLO cuando el pago es confirmado.
      if (pendingCreatePlan) {
        sessionStorage.setItem(
          PENDING_STORE_KEY,
          JSON.stringify({
            name: storeName,
            description: storeDescription || undefined,
            businessType: storeBusinessType,
            ...(storeBusinessType === 'BELLEZA' ? { schedule } : {}),
          }),
        );
        setShowCreateForm(false);
        setShowUpgradeModal(true);
        return;
      }

      // Plan free: la tienda se crea al momento, como siempre.
      const newStore = await api.stores.create({
        name: storeName,
        description: storeDescription || undefined,
        businessType: storeBusinessType,
        ...(storeBusinessType === 'BELLEZA' ? { schedule } : {}),
      });
      setStore(newStore);
      setShowCreateForm(false);
      setStoreBusinessType('OTRO');
    } catch (err) {
      console.error('Error creating store:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleSpaceSelect = (selection: SpaceSelection) => {
    setShowSpaceModal(false);
    setPendingCreatePlan(selection.type === 'paid' ? selection : null);
    setShowCreateForm(true);
  };

  // Un pago SIN tienda fue confirmado: crea la tienda con los datos guardados.
  // El backend le aplica el plan ya pagado (store.routes.ts). Devuelve true si
  // la tienda se creó correctamente.
  const finalizePaidStore = async (): Promise<boolean> => {
    const draft = readStoreDraft();
    if (!draft) return false;
    try {
      const created = await api.stores.create({
        name: draft.name,
        description: draft.description,
        businessType: draft.businessType,
        ...(draft.businessType === 'BELLEZA' && draft.schedule ? { schedule: draft.schedule } : {}),
      });
      sessionStorage.removeItem(PENDING_STORE_KEY);
      setStore(created);
      return true;
    } catch (err) {
      console.error('Error creando la tienda tras el pago:', err);
      return false;
    }
  };

  const openUpgrade = () => setShowUpgradeModal(true);

  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!store) return;
    setFormError(null);
    const price = Number(productPrice);
    const stock = Number(productStock);
    if (!productName.trim() || Number.isNaN(price) || price <= 0) {
      setFormError('Ingresa un nombre válido y un precio mayor a 0.');
      return;
    }
    if (Number.isNaN(stock) || stock < 0 || !Number.isInteger(stock)) {
      setFormError('Ingresa un stock válido (número entero mayor o igual a 0).');
      return;
    }

    setAddingProduct(true);
    try {
      const product = await api.products.create(store.id, {
        name: productName.trim(),
        description: productDescription.trim() || undefined,
        price,
        stock,
        imageUrl: productImageUrl.trim() || undefined,
        attributes: productAttributes,
      });
      setStore((prev) =>
        prev ? { ...prev, products: [...(prev.products || []), product] } : prev
      );
      setShowProductForm(false);
      setProductName('');
      setProductDescription('');
      setProductPrice('');
      setProductStock('');
      setProductImageUrl('');
      setProductAttributes({});
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al crear producto');
    } finally {
      setAddingProduct(false);
    }
  };

  const handleAdjustStock = async (product: Product) => {
    const input = window.prompt(
      `Nuevo stock para "${product.name}" (0 = se desactiva solo):`,
      String(product.stock ?? 0)
    );
    if (input === null) return;
    const stock = Number(input);
    if (Number.isNaN(stock) || stock < 0 || !Number.isInteger(stock)) {
      setFormError('Ingresa un stock válido (entero >= 0).');
      return;
    }
    try {
      const updated = await api.products.update(product.id, { stock });
      setStore((prev) =>
        prev
          ? {
              ...prev,
              products: (prev.products || []).map((p) =>
                p.id === product.id ? { ...p, ...updated } : p
              ),
            }
          : prev
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al ajustar stock');
    }
  };

  const handleOpenEdit = () => {
    if (!store) return;
    setEditStoreName(store.name);
    setEditStoreDescription(store.description ?? '');
    setEditLogoUrl(store.logoUrl ?? '');
    setEditBannerUrl(store.bannerUrl ?? '');
    setEditWhatsapp(store.whatsapp ?? '');
    setShowEditModal(true);
  };

  const handleSaveStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!store) return;
    setSavingStore(true);
    setFormError(null);
    try {
      const updated = await api.stores.update(store.id, {
        name: editStoreName.trim(),
        description: editStoreDescription.trim() || undefined,
        logoUrl: editLogoUrl.trim() || undefined,
        bannerUrl: editBannerUrl.trim() || undefined,
        whatsapp: editWhatsapp.trim() || undefined,
      });
      // Refresca desde el endpoint de detalle para traer los contadores actualizados.
      const detail = await api.stores.getBySlug(updated.slug);
      setStore(detail);
      setShowEditModal(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al guardar la tienda');
    } finally {
      setSavingStore(false);
    }
  };

  const handleProductImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    setFormError(null);
    try {
      const url = await api.upload(file);
      setProductImageUrl(url);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al subir la imagen');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSavingStore(true);
    setFormError(null);
    try {
      const url = await api.upload(file);
      setEditLogoUrl(url);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al subir la imagen');
    } finally {
      setSavingStore(false);
    }
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSavingStore(true);
    setFormError(null);
    try {
      const url = await api.upload(file);
      setEditBannerUrl(url);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Error al subir la imagen');
    } finally {
      setSavingStore(false);
    }
  };

  const renderProductCard = (product: Product) => (
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
          <p className="text-sm text-surface-500 font-semibold">{formatCOP(product.price)}</p>
          {attributesToTitledList(store?.businessType ?? 'OTRO', product.attributes).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {attributesToTitledList(store?.businessType ?? 'OTRO', product.attributes).map((a) => (
                <span
                  key={a.key}
                  className="px-1.5 py-0.5 text-[10px] font-semibold bg-brand-50 text-brand-700 border border-brand-100 rounded-md"
                >
                  {a.label}: {a.value}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        {typeof product.stock === 'number' && (
          <span
            className={`px-2.5 py-1 text-xs font-bold rounded-full ${
              product.stock > 0
                ? 'bg-surface-200 text-surface-700'
                : 'bg-accent-100 text-accent-700'
            }`}
          >
            {product.stock > 0 ? `${product.stock} en stock` : 'Agotado'}
          </span>
        )}
        <span
          className={`px-2.5 py-1 text-xs font-bold rounded-full ${
            product.available
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-accent-100 text-accent-700'
          }`}
        >
          {product.available ? 'Disponible' : 'No disponible'}
        </span>
        <button
          type="button"
          onClick={() => handleAdjustStock(product)}
          title="Ajustar stock"
          className="p-1.5 text-surface-500 hover:text-brand-600 transition-colors"
        >
          <Settings2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen pt-[7.5rem] md:pt-16 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-[7.5rem] md:pt-16">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-r from-brand-600 to-accent-500 flex items-center justify-center shadow-soft">
            <LayoutDashboard className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-surface-900 leading-tight tracking-tight">Dashboard</h1>
            <p className="text-sm text-surface-500">Gestiona tu tienda y tus productos</p>
          </div>
        </div>

        {!store && !showCreateForm ? (
          <div className="card p-12 text-center">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand-100 to-accent-100 text-brand-600 flex items-center justify-center mx-auto mb-5">
              <StoreIcon className="w-10 h-10" />
            </div>
            <h2 className="font-display text-xl font-bold text-surface-900 mb-2">Crea tu tienda</h2>
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
            <h2 className="font-display text-xl font-bold text-surface-900 mb-6">Nueva Tienda</h2>
            {pendingCreatePlan && (
              <p className="text-xs text-brand-600 -mt-4 mb-4">
                Pagarás primero; tu tienda se creará solo cuando el pago sea confirmado.
              </p>
            )}
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
                  Tipo de tienda
                </label>
                <select
                  value={storeBusinessType}
                  onChange={(e) => setStoreBusinessType(e.target.value as typeof storeBusinessType)}
                  className="input"
                >
                  <option value="ROPA">Ropa</option>
                  <option value="CALZADO">Calzado</option>
                  <option value="ACCESORIOS">Accesorios / Joyería / Relojes</option>
                  <option value="HOGAR">Hogar</option>
                  <option value="ALIMENTOS">Alimentos</option>
                  <option value="SERVICIOS">Servicios</option>
                  <option value="BELLEZA">Belleza y Spa</option>
                  <option value="OTRO">Otro</option>
                </select>
                <p className="text-xs text-surface-500 mt-1">
                  El asistente de IA del chat se adapta a este tipo de tienda: pregunta los datos
                  adecuados (talla, modelo, cantidad, fecha, etc.) antes de confirmar un pedido.
                </p>
              </div>

              {storeBusinessType === 'BELLEZA' && (
                <div className="rounded-2xl bg-surface-50 border border-surface-200 p-4 space-y-3">
                  <p className="text-sm font-semibold text-surface-700">
                    Horario de agenda
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-xs font-medium text-surface-500">Abre</span>
                      <input
                        type="time"
                        value={schedule.openTime}
                        onChange={(e) => setSchedule({ ...schedule, openTime: e.target.value })}
                        className="input"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-surface-500">Cierra</span>
                      <input
                        type="time"
                        value={schedule.closeTime}
                        onChange={(e) => setSchedule({ ...schedule, closeTime: e.target.value })}
                        className="input"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-surface-500">Almuerzo desde</span>
                      <input
                        type="time"
                        value={schedule.lunchStart}
                        onChange={(e) => setSchedule({ ...schedule, lunchStart: e.target.value })}
                        className="input"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-surface-500">Almuerzo hasta</span>
                      <input
                        type="time"
                        value={schedule.lunchEnd}
                        onChange={(e) => setSchedule({ ...schedule, lunchEnd: e.target.value })}
                        className="input"
                      />
                    </label>
                  </div>
                  <div>
                    <span className="text-xs font-medium text-surface-500">Días de atención</span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {[
                        ['D', 0], ['L', 1], ['M', 2], ['X', 3], ['J', 4], ['V', 5], ['S', 6],
                      ].map(([label, day]) => {
                        const d = day as number;
                        const active = schedule.workingDays.includes(d);
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() =>
                              setSchedule({
                                ...schedule,
                                workingDays: active
                                  ? schedule.workingDays.filter((w) => w !== d)
                                  : [...schedule.workingDays, d].sort(),
                              })
                            }
                            className={`w-10 h-10 rounded-xl text-sm font-bold transition-all ${
                              active
                                ? 'bg-brand-600 text-white shadow-soft'
                                : 'bg-white text-surface-400 border border-surface-200 hover:border-brand-300'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

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
                  {pendingCreatePlan ? (
                    'Continuar al pago'
                  ) : creating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creando...
                    </>
                  ) : (
                    'Crear Tienda'
                  )}
                </button>
                <button type="button" onClick={() => { setShowCreateForm(false); setPendingCreatePlan(null); sessionStorage.removeItem(PENDING_STORE_KEY); }} className="btn-ghost">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        ) : store ? (
          <div className="space-y-6">
            {store.plan !== 'FREE' && store.subscriptionExpiresAt && (() => {
              const daysLeft = Math.ceil(
                (new Date(store.subscriptionExpiresAt!).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
              );
              if (daysLeft <= 0) return null;
              const urgent = daysLeft <= 3;
              const expiresOn = new Date(store.subscriptionExpiresAt!).toLocaleDateString('es-CO', {
                day: 'numeric',
                month: 'long',
              });
              return (
                <div
                  className={`rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-2 ${
                    urgent ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-11 h-11 rounded-xl text-white flex items-center justify-center shrink-0 ${
                        urgent ? 'bg-red-500' : 'bg-amber-500'
                      }`}
                    >
                      <AlertTriangle className="w-6 h-6" />
                    </div>
                    <div>
                      <p className={`font-display text-base font-extrabold ${urgent ? 'text-red-700' : 'text-amber-800'}`}>
                        {urgent ? '¡Tu plan vence muy pronto!' : 'Tu plan Premium está por vencer'}
                      </p>
                      <p className={`text-sm ${urgent ? 'text-red-600' : 'text-amber-700'}`}>
                        {daysLeft === 1 ? 'Te queda 1 día' : `Te quedan ${daysLeft} días`} · vence el{' '}
                        <strong className="font-bold">{expiresOn}</strong>. Renueva tu espacio antes de volver a ser Free.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={openUpgrade}
                    className={`shrink-0 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-colors ${
                      urgent ? 'bg-red-600 hover:bg-red-700' : 'bg-gradient-to-r from-brand-600 to-accent-500 hover:from-brand-700 hover:to-accent-600'
                    }`}
                  >
                    Renovar plan
                  </button>
                </div>
              );
            })()}
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
                    <h2 className="font-display text-lg font-bold text-surface-900 flex items-center gap-1.5">
                      {store.name}
                      {store.verified && (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-600 text-white shrink-0">
                          <BadgeCheck className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </h2>
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
                <div className="flex gap-2 w-full sm:w-auto">
                  <button onClick={() => navigate(`/store/${store.slug}`)} className="btn-ghost text-sm flex-1 sm:flex-none">
                    <ExternalLink className="w-4 h-4" />
                    Ver Tienda
                  </button>
                  <button
                    onClick={handleOpenEdit}
                    className="btn-ghost text-sm flex-1 sm:flex-none"
                  >
                    <Pencil className="w-4 h-4" />
                    Personalizar
                  </button>
                </div>
              </div>
            </div>

            <DashboardSubscription store={store} onUpgrade={openUpgrade} />

            <ShareStoreCard
              url={`${window.location.origin}/store/${store.slug}`}
              name={store.name}
            />

            <PrestigeCard onUpgrade={openUpgrade} />

            <SalesDashboard store={store} onUpgrade={openUpgrade} />

            {store.businessType === 'BELLEZA' && (
              <BeautyServicesPanel
                store={store}
                onStoreUpdated={(s) => setStore(s)}
              />
            )}

            <div className="card p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="font-display text-lg font-bold text-surface-900">Productos</h3>
                  <p className="text-xs text-surface-500">
                    {store.products?.length ?? 0} / {productLimit(store.plan)} en tu plan {store.plan}
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (!showProductForm) setProductAttributes({});
                    setShowProductForm((v) => !v);
                  }}
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
                        Precio (COP)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={productPrice}
                        onChange={(e) => setProductPrice(e.target.value)}
                        required
                        className="input"
                        placeholder="29.900"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                        Stock disponible
                      </label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={productStock}
                        onChange={(e) => setProductStock(e.target.value)}
                        required
                        className="input"
                        placeholder="Ej: 50"
                      />
                      <p className="text-xs text-surface-400 mt-1">
                        Se oculta en tu tienda. Al llegar a 0 el producto se desactiva solo.
                      </p>
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
                  {fieldsFor(store.businessType).length > 0 && (
                    <div className="p-4 bg-white rounded-2xl border border-surface-200">
                      <p className="text-sm font-semibold text-surface-800 flex items-center gap-1.5">
                        <Settings2 className="w-4 h-4 text-surface-400" />
                        Detalles para tu tipo de tienda
                      </p>
                      <p className="text-xs text-surface-400 mt-0.5 mb-3">
                        La IA del chat usará estos datos para identificar la variante exacta que elige tu cliente.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {fieldsFor(store.businessType).map((field) => (
                          <div key={field.key}>
                            <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                              {field.label}
                            </label>
                            {field.type === 'select' && (
                              <select
                                value={String(productAttributes[field.key] ?? '')}
                                onChange={(e) =>
                                  setProductAttributes((prev) => ({ ...prev, [field.key]: e.target.value }))
                                }
                                className="input"
                              >
                                <option value="">— Selecciona —</option>
                                {(field.options ?? []).map((o) => (
                                  <option key={o} value={o}>{o}</option>
                                ))}
                              </select>
                            )}
                            {field.type === 'number' && (
                              <input
                                type="number"
                                min={field.min}
                                max={field.max}
                                value={String(productAttributes[field.key] ?? '')}
                                onChange={(e) =>
                                  setProductAttributes((prev) => ({ ...prev, [field.key]: e.target.value === '' ? '' : Number(e.target.value) }))
                                }
                                className="input"
                                placeholder={field.placeholder}
                              />
                            )}
                            {field.type === 'boolean' && (
                              <button
                                type="button"
                                onClick={() =>
                                  setProductAttributes((prev) => ({ ...prev, [field.key]: !(prev[field.key] as boolean | undefined) }))
                                }
                                className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold transition-colors ${
                                  productAttributes[field.key]
                                    ? 'bg-accent-50 border-accent-300 text-accent-600'
                                    : 'border-surface-300 text-surface-500 hover:border-surface-400'
                                }`}
                              >
                                <span className={`w-3.5 h-3.5 rounded-full border-2 ${productAttributes[field.key] ? 'bg-accent-500 border-accent-500' : 'border-surface-300'}`} />
                                {productAttributes[field.key] ? 'Sí' : 'No'}
                              </button>
                            )}
                            {field.type === 'text' && (
                              <input
                                type="text"
                                value={String(productAttributes[field.key] ?? '')}
                                onChange={(e) =>
                                  setProductAttributes((prev) => ({ ...prev, [field.key]: e.target.value }))
                                }
                                className="input"
                                placeholder={field.placeholder}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                      Imagen del producto (opcional)
                    </label>
                    <div className="flex items-center gap-3">
                      <div className="w-14 h-14 rounded-xl bg-surface-100 flex items-center justify-center overflow-hidden shrink-0">
                        {productImageUrl ? (
                          <img src={productImageUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <ImageIcon className="w-6 h-6 text-surface-400" />
                        )}
                      </div>
                      <div className="flex-1 space-y-1.5">
                        <label className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold bg-surface-900 text-white rounded-xl cursor-pointer hover:bg-surface-800 transition-colors">
                          {uploadingImage ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Upload className="w-3.5 h-3.5" />
                          )}
                          {uploadingImage ? 'Subiendo...' : 'Subir imagen'}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                            hidden
                            disabled={uploadingImage}
                            onChange={handleProductImageUpload}
                          />
                        </label>
                        <p className="text-xs text-surface-400">Máx. 5 MB (jpg, png, webp, gif)</p>
                      </div>
                    </div>
                    <input
                      type="url"
                      value={productImageUrl}
                      onChange={(e) => setProductImageUrl(e.target.value)}
                      className="input mt-2"
                      placeholder="...o pega una URL https://"
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
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:hidden">
                    {(showAllProducts ? store.products : store.products.slice(0, 5)).map(renderProductCard)}
                  </div>
                  <div className="hidden md:grid md:grid-cols-2 gap-3">
                    {store.products.map(renderProductCard)}
                  </div>
                  {store.products.length > 5 && (
                    <button
                      type="button"
                      onClick={() => setShowAllProducts((v) => !v)}
                      className="md:hidden mt-4 w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-bold text-brand-600 bg-brand-50 border border-brand-100 rounded-xl hover:bg-brand-100 transition-colors"
                    >
                      {showAllProducts ? (
                        <>
                          Ver menos
                          <ChevronUp className="w-4 h-4" />
                        </>
                      ) : (
                        <>
                          Ver más ({store.products.length - 5} más)
                          <ChevronDown className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  )}
                </>
              )}
            </div>

            {store.plan !== 'FREE' && store.subscriptionExpiresAt && (() => {
              const daysLeft = Math.max(
                0,
                Math.ceil((new Date(store.subscriptionExpiresAt!).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
              );
              if (daysLeft <= 0) return null;
              return (
                <div className="card p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t-4 border-brand-600">
                  <div>
                    <p className="font-display text-sm font-extrabold text-surface-900">
                      {daysLeft === 1 ? 'Te queda 1 día' : `Te quedan ${daysLeft} días`} de tu plan {store.plan}
                    </p>
                    <p className="text-xs text-surface-500">
                      Cada referido que paga su plan te suma 3 días más.
                    </p>
                  </div>
                  <button onClick={openUpgrade} className="btn-primary text-sm shrink-0">
                    Renovar
                  </button>
                </div>
              );
            })()}
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

        <UpgradeSpaceModal
          open={showUpgradeModal}
          storeId={store?.id}
          onClose={() => {
            setShowUpgradeModal(false);
            setPendingCreatePlan(null);
            sessionStorage.removeItem(PENDING_STORE_KEY);
          }}
          onPaymentResult={(state) => {
            if (state?.kind === 'success') {
              setShowUpgradeModal(false);
              setUnlockedPlan(state.plan);
              setUnlockedCycle(state.cycle);
              // Si se pagó sin tienda, crearla YA (el backend le aplica el plan).
              (async () => {
                const hasDraft = !!readStoreDraft();
                const ok = hasDraft ? await finalizePaidStore() : true;
                if (ok) {
                  setPaymentResult({ kind: 'success', plan: state.plan, cycle: state.cycle });
                }
                loadUserStore();
              })();
            } else if (state?.kind === 'failure') {
              setShowUpgradeModal(false);
              setPaymentResult(state);
            }
          }}
        />

        <PremiumUnlockedModal
          open={showPremiumUnlocked}
          plan={unlockedPlan}
          cycle={unlockedCycle}
          onClose={() => setShowPremiumUnlocked(false)}
        />

        <PaymentResultModal
          open={paymentResult}
          onClose={() => setPaymentResult(null)}
          onRetry={retryPayment}
        />

        {showEditModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
            <div
              className="absolute inset-0 bg-surface-900/50 backdrop-blur-sm"
              onClick={() => setShowEditModal(false)}
            />
            <div className="card p-6 md:p-7 w-full max-w-lg relative shadow-lift my-8">
              <button
                onClick={() => setShowEditModal(false)}
                aria-label="Cerrar"
                className="absolute top-3 right-3 p-2 rounded-full hover:bg-surface-100 text-surface-500 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-r from-brand-600 to-accent-500 flex items-center justify-center shrink-0">
                  <Palette className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-display text-xl font-bold text-surface-900 leading-tight tracking-tight">
                    Personaliza tu tienda
                  </h2>
                  <p className="text-sm text-surface-500">
                    Tu marca se muestra en la portada y el perfil
                  </p>
                </div>
              </div>

              {/* Vistas previas */}
              <div className="mb-5 rounded-2xl overflow-hidden border border-surface-200">
                <div className="h-24 bg-gradient-to-r from-brand-600 to-accent-500 relative flex items-end">
                  {editBannerUrl.trim() && (
                    <img src={editBannerUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                  )}
                  <div className="absolute -bottom-6 left-4 w-14 h-14 rounded-xl bg-white shadow-lift flex items-center justify-center overflow-hidden ring-4 ring-white">
                    {editLogoUrl.trim() ? (
                      <img src={editLogoUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-brand-600 text-2xl font-extrabold">
                        {(editStoreName || '?').charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-10 bg-white" />
              </div>

              <form onSubmit={handleSaveStore} className="space-y-4">
                {formError && (
                  <div className="p-3 bg-accent-50 border border-accent-200 rounded-xl text-sm text-accent-600">
                    {formError}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                    Nombre de la tienda
                  </label>
                  <input
                    type="text"
                    value={editStoreName}
                    onChange={(e) => setEditStoreName(e.target.value)}
                    required
                    minLength={2}
                    className="input"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                    Descripción
                  </label>
                  <textarea
                    value={editStoreDescription}
                    onChange={(e) => setEditStoreDescription(e.target.value)}
                    rows={2}
                    className="input resize-none"
                    placeholder="Cuéntanos sobre tu marca..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                    WhatsApp (solo número, ej: 56912345678)
                  </label>
                  <input
                    type="text"
                    value={editWhatsapp}
                    onChange={(e) => setEditWhatsapp(e.target.value)}
                    className="input"
                    placeholder="56912345678"
                    maxLength={20}
                  />
                  <p className="text-xs text-surface-400 mt-1">
                    Usado para que los clientes cierren la compra por WhatsApp.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                    Foto de perfil (logo)
                  </label>
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-surface-100 flex items-center justify-center overflow-hidden shrink-0">
                      {editLogoUrl ? (
                        <img src={editLogoUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon className="w-5 h-5 text-surface-400" />
                      )}
                    </div>
                    <div className="flex-1 flex gap-2">
                      <label className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold bg-surface-900 text-white rounded-xl cursor-pointer hover:bg-surface-800 transition-colors shrink-0">
                        <Upload className="w-3.5 h-3.5" />
                        Subir
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                          hidden
                          disabled={savingStore}
                          onChange={handleLogoUpload}
                        />
                      </label>
                      <input
                        type="url"
                        value={editLogoUrl}
                        onChange={(e) => setEditLogoUrl(e.target.value)}
                        className="input"
                        placeholder="https://..."
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-surface-700 mb-1.5">
                    Foto de portada (banner)
                  </label>
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-surface-100 flex items-center justify-center overflow-hidden shrink-0">
                      {editBannerUrl ? (
                        <img src={editBannerUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <ImageIcon className="w-5 h-5 text-surface-400" />
                      )}
                    </div>
                    <div className="flex-1 flex gap-2">
                      <label className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold bg-surface-900 text-white rounded-xl cursor-pointer hover:bg-surface-800 transition-colors shrink-0">
                        <Upload className="w-3.5 h-3.5" />
                        Subir
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                          hidden
                          disabled={savingStore}
                          onChange={handleBannerUpload}
                        />
                      </label>
                      <input
                        type="url"
                        value={editBannerUrl}
                        onChange={(e) => setEditBannerUrl(e.target.value)}
                        className="input"
                        placeholder="https://..."
                      />
                    </div>
                  </div>
                </div>

                <p className="text-xs text-surface-400">
                  Escoge una imagen desde tu dispositivo (máx. 5 MB) o pega una URL.
                </p>

                <div className="flex gap-3 pt-2">
                  <button type="submit" disabled={savingStore} className="btn-primary flex-1">
                    {savingStore ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Guardando...
                      </>
                    ) : (
                      'Guardar cambios'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowEditModal(false)}
                    className="btn-ghost"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDaysLeft(ms: number | undefined): string {
  if (!ms) return '';
  const days = Math.max(0, Math.ceil((ms - Date.now()) / (24 * 60 * 60 * 1000)));
  return `${days} día${days !== 1 ? 's' : ''}`;
}

function DashboardSubscription({ store, onUpgrade }: { store: Store; onUpgrade: () => void }) {
  const status = store.subscriptionStatus ?? 'trial';
  const trialEndsAt = store.trialEndsAt;
  const [open, setOpen] = useState(false);

  if (status === 'active') {
    const benefits = [
      {
        icon: <LayoutDashboard className="w-4 h-4" />,
        title: 'Tu centro de mando',
        desc: 'Desde aquí controlas todo tu negocio en un solo lugar: tu vitrina, tus ventas, tu stock y tu prestigio.',
      },
      {
        icon: <TrendingUp className="w-4 h-4" />,
        title: 'Métricas en tiempo real',
        desc: 'Mira tus ventas de hoy, tus ingresos totales, los productos más vistos y tu tasa de conversión. Sabes cómo va tu negocio sin salir del panel.',
      },
      {
        icon: <Package className="w-4 h-4" />,
        title: `Catálogo de hasta ${store.plan === 'BUSINESS' ? 500 : 100} productos`,
        desc: 'Publica, edita y controla el stock de todo tu catálogo. Cuando algo se agota, la plataforma lo desactiva sola para que no overvendas.',
      },
      {
        icon: <Users className="w-4 h-4" />,
        title: 'Ventas y referidos que suman',
        desc: 'Registra tus ventas, gana prestigio con cada referido y sube el nivel de tu tienda hasta el sello de verificado.',
      },
      ...(store.plan !== 'FREE'
        ? [
            {
              icon: <Bot className="w-4 h-4" />,
              title: 'Asistente IA que vende por ti',
              desc: 'Tu chat responde solo: atiende a los clientes, les da precios, les responde del producto y los lleva a tu WhatsApp para cerrar la venta.',
            },
          ]
        : []),
    ];

    return (
      <div className="card overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full p-5 flex items-center gap-4 text-left hover:bg-surface-50/60 transition-colors"
        >
          <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-surface-900">Espacio Premium activo</p>
            <p className="text-sm text-surface-600 mt-0.5">
              Tu plan {store.plan} está desbloqueando el dashboard completo.
            </p>
            <span className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 text-xs font-bold bg-emerald-100 text-emerald-700 rounded-full">
              <CreditCard className="w-3.5 h-3.5" />
              Plan {store.plan} activo
            </span>
          </div>
          <div className="w-8 h-8 rounded-full bg-surface-900 text-white flex items-center justify-center shrink-0">
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </button>

        {open && (
          <div className="px-5 pb-5 border-t border-surface-100">
            <p className="text-sm text-surface-500 pt-4">
              Esto es lo que tu dashboard ya está haciendo por ti:
            </p>
            <ul className="mt-3 space-y-3">
              {benefits.map((b) => (
                <li key={b.title} className="flex items-start gap-3">
                  <div className="mt-0.5 w-7 h-7 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                    {b.icon}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-surface-900">{b.title}</p>
                    <p className="text-sm text-surface-600">{b.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-start gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-100">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              <p className="text-sm text-emerald-800">
                Estás en el plan completo: los reportes, el stock y el asistente IA están activos ahora mismo.
              </p>
            </div>
          </div>
        )}
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
          <p className="font-bold text-surface-900">Activa tu Espacio Premium</p>
          <p className="text-sm text-surface-600 mt-0.5">
            El contacto con tus clientes sigue disponible. Al activar tu espacio desbloqueas el
            sistema de prestigio, tu enlace de referidos y el límite ampliado de productos.
          </p>
          <button
            onClick={onUpgrade}
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-gradient-to-r from-brand-600 to-accent-500 text-white rounded-full hover:from-brand-700 hover:to-accent-600 transition-all"
          >
            <CreditCard className="w-3.5 h-3.5" />
            Activar Espacio Premium
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
          Disfrutas de <strong>30 días</strong> de prueba. El contacto con tus clientes
          está disponible siempre.{' '}
          <span className="font-semibold text-brand-700">
            Activa tu plan de pago para desbloquear el sistema de prestigio.
          </span>
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

function productLimit(plan: string | undefined): number {
  const limits: Record<string, number> = { FREE: 20, PRO: 100, BUSINESS: 500 };
  return limits[plan ?? 'FREE'] ?? 20;
}