import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Package, ShieldCheck } from 'lucide-react';
import { Order } from '@/types';
import { api } from '@/services/api';
import { useAuth } from '@/stores/authStore';
import { formatCOP } from '@/lib/format';
import { ProtectedCheckoutModal } from '@/components/ProtectedCheckoutModal';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  sold: 'Confirmado',
  cancelled: 'Cancelado',
};

const PROTECTED_LABEL: Record<string, string> = {
  initiated: 'Pago iniciado',
  collected: 'Cobrado',
  held: 'Retenido 🛡️',
  released: 'Liberado 🛡️',
  paid_out: 'Pagado a la tienda',
  refunded: 'Devuelto',
  cancelled: 'Cancelado',
};

function orderTotal(o: Order): number {
  return o.items.reduce((acc, it) => acc + Number(it.unitPrice) * Number(it.quantity), 0);
}

export function MisComprasPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [payOrderId, setPayOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }
    api.orders.mine().then(setOrders).catch(() => setOrders([]));
  }, [isAuthenticated, navigate]);

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen pt-[7.5rem] md:pt-16">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-900 mb-5">
          <ArrowLeft className="w-4 h-4" />
          Volver
        </Link>
        <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight mb-1 flex items-center gap-2">
          <Package className="w-6 h-6 text-brand-600" />
          Mis compras
        </h1>
        <p className="text-surface-500 text-sm mb-6">Todo lo que pediste, con su estado y pago.</p>

        {orders === null ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
          </div>
        ) : orders.length === 0 ? (
          <div className="card p-10 text-center">
            <p className="font-bold text-surface-700">Aún no tienes pedidos</p>
            <p className="text-sm text-surface-400 mt-1">Cuando pidas por el chat, aparecen aquí.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => (
              <div key={o.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-surface-900 truncate">
                      {o.store?.name ?? 'Tienda'}
                    </p>
                    <p className="text-xs text-surface-500 mt-0.5">
                      {o.items.map((it) => (it.quantity > 1 ? `${it.name} × ${it.quantity}` : it.name)).join(', ')}
                    </p>
                    <p className="text-xs text-surface-400 mt-1">
                      {new Date(o.createdAt).toLocaleDateString('es-CO')} · {STATUS_LABEL[o.status] ?? o.status}
                      {o.protectedStatus && ` · ${PROTECTED_LABEL[o.protectedStatus] ?? o.protectedStatus}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-extrabold text-surface-900">{formatCOP(orderTotal(o))}</p>
                    {o.status === 'pending' && !o.protectedStatus && (
                      <button
                        onClick={() => setPayOrderId(o.id)}
                        className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-gradient-to-r from-brand-600 to-accent-500 text-white text-xs font-bold"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Pagar protegido
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {payOrderId && (
          <ProtectedCheckoutModal
            orderId={payOrderId}
            onClose={() => setPayOrderId(null)}
            onPaid={() => {
              setPayOrderId(null);
              api.orders.mine().then(setOrders).catch(() => {});
            }}
          />
        )}
      </div>
    </div>
  );
}
