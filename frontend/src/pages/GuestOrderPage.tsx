import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Package, Search, ShieldCheck } from 'lucide-react';
import { api, GuestOrderStatus } from '@/services/api';
import { formatCOP } from '@/lib/format';

const ORDER_LABEL: Record<string, string> = {
  pending: 'Pendiente de confirmación',
  sold: 'Confirmado por la tienda',
  cancelled: 'Cancelado',
};

const PAYMENT_LABEL: Record<string, string> = {
  initiated: 'Pago iniciado',
  collected: 'Pago en proceso',
  held: 'Dinero protegido 🛡️',
  released: 'Dinero liberado a la tienda',
  paid_out: 'Pagado a la tienda',
  refunded: 'Dinero devuelto',
  cancelled: 'Pago cancelado',
};

export function GuestOrderPage() {
  const [params, setParams] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState(params.get('code') ?? '');
  const [order, setOrder] = useState<GuestOrderStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = useCallback(
    async (mail: string, guestCode: string, silent = false) => {
      if (!mail.trim() || !guestCode.trim()) {
        if (!silent) setError('Escribe tu email y tu código de acceso.');
        return;
      }
      if (!silent) setLoading(true);
      try {
        const data = await api.orders.guestStatus(mail.trim(), guestCode.trim());
        setOrder(data);
        setError(null);
      } catch (err) {
        if (!silent) {
          setOrder(null);
          setError(err instanceof Error ? err.message : 'No encontramos esa compra.');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    document.title = 'Seguir mi pedido · CC Platform';
    const mail = params.get('email');
    const guestCode = params.get('code');
    if (mail && guestCode) void lookup(mail, guestCode, true);
  }, [lookup, params]);

  useEffect(() => {
    if (!order) return;
    if (order.payment?.status !== 'initiated' && order.payment?.status !== 'collected') return;
    const id = window.setInterval(() => void lookup(email, code, true), 5000);
    return () => window.clearInterval(id);
  }, [order, email, code, lookup]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setParams({ email: email.trim(), code: code.trim() });
    void lookup(email, code);
  };

  return (
    <div className="min-h-screen pt-[7.5rem] md:pt-16">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-900 mb-5">
          <ArrowLeft className="w-4 h-4" />
          Volver al inicio
        </Link>

        <div className="card p-5 md:p-7">
          <h1 className="font-display text-2xl font-bold text-surface-900">Seguir mi pedido</h1>
          <p className="text-sm text-surface-500 mt-1">
            Consulta tu compra de invitado con el email y el código que recibiste.
          </p>

          <form onSubmit={submit} className="mt-5 grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
            <label className="block">
              <span className="text-sm font-medium text-surface-700">Email</span>
              <input
                type="email"
                className="input mt-1"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.com"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-surface-700">Código</span>
              <input
                className="input mt-1 font-mono"
                value={code}
                onChange={(e) => setCode(e.target.value.trim())}
                placeholder="CICI-XXXX"
              />
            </label>
            <button type="submit" disabled={loading} className="btn-primary inline-flex items-center justify-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Consultar
            </button>
          </form>

          {error && (
            <p className="mt-4 rounded-xl bg-accent-50 border border-accent-100 p-3 text-sm text-accent-700">
              {error}
            </p>
          )}
        </div>

        {order && (
          <div className="card p-5 md:p-7 mt-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-surface-400">
                  Pedido {order.orderId.slice(0, 8)}
                </p>
                <h2 className="font-display text-xl font-bold text-surface-900 mt-0.5">
                  {ORDER_LABEL[order.status] ?? order.status}
                </h2>
                {order.store && (
                  <Link to={`/store/${order.store.slug}`} className="text-sm text-brand-600 hover:underline">
                    {order.store.name}
                  </Link>
                )}
              </div>
              <Package className="w-6 h-6 text-surface-300" />
            </div>

            <div className="mt-4 space-y-2">
              {order.items.map((item, i) => (
                <div key={`${item.name}-${i}`} className="flex justify-between text-sm">
                  <span className="text-surface-700">
                    {item.quantity} × {item.name}
                  </span>
                  <span className="font-medium text-surface-900">
                    {formatCOP(item.unitPrice * item.quantity)}
                  </span>
                </div>
              ))}
            </div>

            {order.payment && (
              <div className="mt-4 rounded-xl bg-surface-50 border border-surface-200 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-surface-800">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  {PAYMENT_LABEL[order.payment.status] ?? order.payment.status}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-1 text-sm text-surface-600">
                  <span>Método</span>
                  <span className="text-right font-medium">{order.payment.method}</span>
                  <span>Total a pagar</span>
                  <span className="text-right font-medium">{formatCOP(order.payment.charge)}</span>
                  <span>Le llega a la tienda</span>
                  <span className="text-right font-medium">{formatCOP(order.payment.sellerNet)}</span>
                </div>
                {(order.payment.status === 'initiated' || order.payment.status === 'collected') && (
                  <p className="mt-2 text-xs text-surface-400">
                    Actualizamos el estado automáticamente. Si pagaste en el banco, puede tardar unos
                    minutos en reflejarse.
                  </p>
                )}
              </div>
            )}

            {order.note && <p className="mt-4 text-sm text-surface-500">{order.note}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
