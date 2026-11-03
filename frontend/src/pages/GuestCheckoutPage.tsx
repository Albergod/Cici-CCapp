import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Copy,
  Loader2,
  MessageCircle,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
} from 'lucide-react';
import { api } from '@/services/api';
import { Store } from '@/types';
import { formatCOP } from '@/lib/format';

export function GuestCheckoutPage() {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const productId = params.get('product') ?? '';

  const [store, setStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [quantity, setQuantity] = useState(1);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.orders.guestCreate>> | null>(null);
  const [copied, setCopied] = useState(false);
  const [reported, setReported] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    api.stores
      .getBySlug(slug)
      .then((s) => {
        setStore(s);
        document.title = `Comprar en ${s.name} · CC Platform`;
      })
      .catch((err) =>
        setLoadError(err instanceof Error ? err.message : 'No se pudo cargar la tienda.'),
      )
      .finally(() => setLoading(false));
  }, [slug]);

  const product = useMemo(
    () => store?.products?.find((p) => p.id === productId) ?? null,
    [store, productId],
  );

  const unit = product?.effectivePrice ?? product?.price ?? 0;
  const total = unit * quantity;
  const maxQty = Math.max(1, Math.min(10, Number(product?.stock ?? 10) || 10));

  const submit = async () => {
    setError(null);
    if (!store || !product) return;
    if (!email.trim()) return setError('Escribe tu email para enviarte el comprobante.');

    setBusy(true);
    try {
      const res = await api.orders.guestCreate({
        storeId: store.id,
        items: [{ productId: product.id, quantity }],
        email: email.trim(),
        name: name.trim() || undefined,
        phone: phone.trim() || undefined,
        paymentMethod: 'NEQUI_DIRECTO',
      });
      setResult(res);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el pedido.');
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.guestCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard no disponible */
    }
  };

  const reportPaid = async () => {
    if (!result) return;
    setReporting(true);
    setReportError(null);
    try {
      await api.orders.guestReportPaid(email.trim(), result.guestCode);
      setReported(true);
    } catch (err) {
      setReportError(err instanceof Error ? err.message : 'No se pudo avisar a la tienda.');
    } finally {
      setReporting(false);
    }
  };

  const receiptWhatsapp =
    store?.whatsapp && result
      ? `https://wa.me/${store.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(
          `Hola ${store.name}, ya transferí ${formatCOP(result.charge)} por mi pedido ${result.guestCode}. Envío el comprobante.`,
        )}`
      : null;

  if (loading) {
    return (
      <div className="min-h-screen pt-[7.5rem] md:pt-16 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
      </div>
    );
  }

  if (loadError || !store || !product) {
    return (
      <div className="min-h-screen pt-[7.5rem] md:pt-16 flex items-center justify-center px-4">
        <div className="card p-8 text-center max-w-md">
          <TriangleAlert className="w-8 h-8 text-amber-500 mx-auto mb-3" />
          <p className="text-surface-700 font-medium">
            {loadError || 'El producto ya no está disponible en esta tienda.'}
          </p>
          <Link to={slug ? `/store/${slug}` : '/'} className="btn-primary mt-5 inline-flex">
            Volver a la tienda
          </Link>
        </div>
      </div>
    );
  }

  if (!store.paymentNequi) {
    return (
      <div className="min-h-screen pt-[7.5rem] md:pt-16 flex items-center justify-center px-4">
        <div className="card p-8 text-center max-w-md">
          <TriangleAlert className="w-8 h-8 text-amber-500 mx-auto mb-3" />
          <h1 className="font-display text-xl font-bold text-surface-900">Tienda sin pagos en línea</h1>
          <p className="text-sm text-surface-600 mt-2">
            {store.name} aún no configuró un Nequi para recibir pagos. Escríbele para coordinar tu
            compra.
          </p>
          <Link to={`/store/${store.slug}`} className="btn-primary mt-5 inline-flex">
            Volver a la tienda
          </Link>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen pt-[7.5rem] md:pt-16">
        <div className="max-w-lg mx-auto px-4 py-10">
          <div className="card p-6 md:p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-4">
              <Check className="w-7 h-7" />
            </div>
            <h1 className="font-display text-2xl font-bold text-surface-900">Pedido creado</h1>
            <p className="text-sm text-surface-500 mt-2">
              {store.name} recibirá tu pedido. Guarda este código: junto a tu email es la única forma
              de consultarlo.
            </p>

            <div className="mt-6 rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/60 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                Código de acceso
              </p>
              <p className="mt-2 font-mono text-2xl font-bold tracking-wider text-surface-900 break-all">
                {result.guestCode}
              </p>
              <button onClick={copyCode} className="btn-secondary mt-3 inline-flex items-center gap-2">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copiado' : 'Copiar código'}
              </button>
            </div>

            <div className="mt-5 text-left text-sm space-y-1.5 text-surface-600">
              <p className="flex justify-between">
                <span>Total del pedido</span>
                <span className="font-semibold">{formatCOP(result.total)}</span>
              </p>
              <p className="flex justify-between">
                <span>Total a pagar</span>
                <span className="font-semibold">{formatCOP(result.charge)}</span>
              </p>
              <p className="flex justify-between">
                <span>Método</span>
                <span className="font-semibold">Nequi directo</span>
              </p>
            </div>

            <div className="mt-6 space-y-2 rounded-xl border border-brand-200 bg-brand-50/60 p-4 text-left text-sm">
              <p className="font-semibold text-surface-900">Paga directo por Nequi</p>
              <p className="text-surface-600">
                Transfiere <strong>{formatCOP(result.charge)}</strong> al Nequi:
              </p>
              <p className="font-mono text-xl font-bold text-surface-900 break-all">
                {result.directNequi?.phone ?? store.paymentNequi}
              </p>
              <p className="text-surface-600">Titular: {result.directNequi?.holder ?? store.name}</p>
              <p className="text-xs text-surface-500">
                Cuando termines la transferencia, avísale a la tienda. Confirmará tu pedido al
                verificar el pago.
              </p>
              {reported ? (
                <p className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-700">
                  Avisamos a la tienda que ya pagaste. Confirmará tu pedido cuando verifique el pago.
                </p>
              ) : (
                <button
                  onClick={reportPaid}
                  disabled={reporting}
                  className="btn-primary w-full inline-flex items-center justify-center gap-2"
                >
                  {reporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Ya transferí
                </button>
              )}
              {reportError && <p className="text-sm text-accent-700">{reportError}</p>}
              {receiptWhatsapp && (
                <a
                  href={receiptWhatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary w-full inline-flex items-center justify-center gap-2"
                >
                  <MessageCircle className="w-4 h-4" />
                  Enviar comprobante por WhatsApp
                </a>
              )}
            </div>

            <button
              onClick={() =>
                navigate(
                  `/pedido?email=${encodeURIComponent(email.trim())}&code=${encodeURIComponent(result.guestCode)}`,
                )
              }
              className="btn-secondary mt-3 w-full"
            >
              Seguir mi pedido
            </button>
            <Link to={`/store/${store.slug}`} className="block text-sm text-surface-500 hover:text-surface-800 mt-4">
              Volver a la tienda
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-[7.5rem] md:pt-16">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Link
          to={`/store/${store.slug}`}
          className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-900 mb-5"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver a {store.name}
        </Link>

        <div className="grid md:grid-cols-[1fr_320px] gap-6 items-start">
          <div className="card p-5 md:p-7">
            <h1 className="font-display text-2xl font-bold text-surface-900">Compra sin cuenta</h1>
            <p className="text-sm text-surface-500 mt-1">
              Paga directo por Nequi. No necesitas registrarte.
            </p>

            <div className="mt-6 space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm font-medium text-surface-700">Nombre (opcional)</span>
                  <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-surface-700">Email *</span>
                  <input
                    type="email"
                    className="input mt-1"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@correo.com"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-surface-700">Celular (opcional)</span>
                  <input className="input mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-surface-700">Cantidad</span>
                  <select
                    className="input mt-1"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                  >
                    {Array.from({ length: maxQty }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4 text-sm">
                <p className="flex items-center gap-2 font-semibold text-surface-900">
                  <Smartphone className="w-4 h-4 text-brand-600" />
                  Pago directo por Nequi
                </p>
                <p className="text-surface-600 mt-1">
                  Transfiere el total al Nequi{' '}
                  <span className="font-mono font-bold text-surface-900">{store.paymentNequi}</span>{' '}
                  ({store.name}). La tienda confirmará tu pedido cuando reciba el pago.
                </p>
              </div>

              {error && (
                <p className="rounded-xl bg-accent-50 border border-accent-100 p-3 text-sm text-accent-700">
                  {error}
                </p>
              )}

              <button
                onClick={submit}
                disabled={busy}
                className="btn-primary w-full inline-flex justify-center items-center gap-2"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                {busy ? 'Creando pedido…' : `Confirmar pedido · ${formatCOP(total)}`}
              </button>
              <p className="text-xs text-surface-400 text-center">
                El pago va directo al Nequi del comerciante; guarda tu comprobante.
              </p>
            </div>
          </div>

          <aside className="card p-5 md:sticky md:top-24">
            <h2 className="font-semibold text-surface-900 mb-3">Tu pedido</h2>
            <div className="flex gap-3">
              <div className="w-16 h-16 rounded-xl bg-surface-100 overflow-hidden shrink-0">
                {product.imageUrl && (
                  <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
                )}
              </div>
              <div className="min-w-0">
                <p className="font-medium text-surface-900 truncate">{product.name}</p>
                <p className="text-sm text-surface-500">
                  {quantity} × {formatCOP(unit)}
                </p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-surface-200 flex justify-between text-sm">
              <span className="text-surface-500">Subtotal</span>
              <span className="font-semibold text-surface-900">{formatCOP(total)}</span>
            </div>
            <div className="mt-3 pt-3 border-t border-surface-200 flex justify-between">
              <span className="font-semibold text-surface-900">Total</span>
              <span className="font-bold text-accent-600">{formatCOP(total)}</span>
            </div>
            <p className="text-xs text-surface-400 mt-3">
              Transfiere este valor al Nequi del comerciante y guarda el comprobante.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
