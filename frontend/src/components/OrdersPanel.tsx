import { useCallback, useEffect, useState } from 'react';
import { Order } from '@/types';
import { api } from '@/services/api';
import { formatCOP } from '@/lib/format';
import { Package, Check, X, Loader2, PackageCheck, Clock } from 'lucide-react';

type Props = {
  /** true: la tienda está en modo FREE (sin IA): no llegan pedidos nuevos. */
  isTrialPaywall?: boolean;
};

function dateLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function OrdersPanel({ isTrialPaywall }: Props) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setOrders(await api.orders.list());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar pedidos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => load(true), 30000);
    return () => clearInterval(timer);
  }, [load]);

  const act = async (id: string, action: 'confirm' | 'cancel') => {
    setBusy(id);
    setNotice(null);
    try {
      if (action === 'confirm') {
        await api.orders.confirm(id);
        setNotice('Pedido confirmado: la venta quedó registrada y el stock actualizado.');
      } else {
        await api.orders.cancel(id);
        setNotice('Pedido cancelado.');
      }
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al procesar el pedido');
    } finally {
      setBusy(null);
    }
  };

  const pending = orders.filter((o) => o.status === 'pending');
  const history = orders.filter((o) => o.status !== 'pending').slice(0, 8);

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center shrink-0">
            <Package className="w-4 h-4" />
          </div>
          <h3 className="font-display font-bold text-surface-900">Pedidos por confirmar</h3>
        </div>
        <span className="text-xs text-surface-400">{pending.length} pendientes</span>
      </div>
      <p className="text-sm text-surface-500 mb-4">
        Tus clientes hacen pedidos por el chat y quedan anotados aquí. Confírmalos para
        registrar la venta y descontar stock automáticamente.
      </p>

      {isTrialPaywall && (
        <div className="mb-4 p-3 rounded-xl bg-accent-50 border border-accent-100 text-sm text-accent-700">
          Tu plan gratuito no genera pedidos nuevos (el asistente IA está apagado). Los pedidos
          pendientes de tu prueba anterior sí puedes confirmarlos o cancelarlos aquí.
        </div>
      )}

      {notice && (
        <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-sm text-emerald-700">
          {notice}
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 rounded-xl bg-accent-50 border border-accent-100 text-sm text-accent-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
        </div>
      ) : pending.length === 0 ? (
        <div className="flex flex-col items-center py-8 text-center">
          <PackageCheck className="w-8 h-8 text-surface-300 mb-2" />
          <p className="text-sm text-surface-500">No hay pedidos por confirmar.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {pending.map((o) => {
            const item = o.items[0];
            return (
              <li key={o.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-50 border border-surface-100">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-surface-900 truncate">
                    {item?.name ?? 'Producto'}
                    {item?.quantity ? <span className="text-surface-500"> × {item.quantity}</span> : null}
                  </p>
                  <p className="text-xs text-surface-500 mt-0.5">
                    {o.customer?.name ?? 'Cliente'}{o.customer ? ' · ' : ''}
                    {formatCOP((item?.quantity ?? 0) * Number(item?.unitPrice ?? 0))}
                  </p>
                  <p className="text-[11px] text-surface-400">{dateLabel(o.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => act(o.id, 'confirm')}
                    disabled={busy === o.id}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" /> Confirmar
                  </button>
                  <button
                    onClick={() => act(o.id, 'cancel')}
                    disabled={busy === o.id}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface-200 text-surface-700 text-xs font-bold hover:bg-surface-300 disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" /> Cancelar
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {history.length > 0 && (
        <div className="mt-6 pt-4 border-t border-surface-100">
          <p className="flex items-center gap-1.5 text-xs font-bold text-surface-400 uppercase tracking-wide mb-3">
            <Clock className="w-3.5 h-3.5" /> Historial reciente
          </p>
          <ul className="space-y-2">
            {history.map((o) => {
              const item = o.items[0];
              return (
                <li key={o.id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-sm text-surface-700 truncate">
                      {item?.name ?? 'Producto'}
                      {item?.quantity ? <span className="text-surface-400"> × {item.quantity}</span> : null}
                    </p>
                    <p className="text-xs text-surface-400">{dateLabel(o.createdAt)}</p>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-bold ${
                      o.status === 'sold' ? 'text-emerald-600' : 'text-accent-500'
                    }`}
                  >
                    {o.status === 'sold' ? 'Vendido' : 'Cancelado'}
                    {o.sale ? ` · ${formatCOP(o.sale.total)}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}