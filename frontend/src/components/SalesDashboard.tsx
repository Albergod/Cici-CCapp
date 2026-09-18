import { useEffect, useMemo, useState } from 'react';
import {
  Package,
  DollarSign,
  Wallet,
  TrendingUp,
  Calendar,
  Plus,
  X,
  Loader2,
  ShoppingCart,
  Trophy,
  Eye,
  Percent,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { RecentSale, SaleStats, Store } from '@/types';
import { api } from '@/services/api';
import { formatCOP } from '@/lib/format';

function fmt(n: number): string {
  return formatCOP(n);
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

export function SalesDashboard({ store }: { store: Store }) {
  const products = store.products ?? [];
  const [stats, setStats] = useState<SaleStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showAllSales, setShowAllSales] = useState(false);
  const [rows, setRows] = useState<{ productId: string; quantity: string }[]>([
    { productId: '', quantity: '1' },
  ]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadStats = async () => {
    setLoading(true);
    api.sales
      .stats()
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadStats();
  }, []);

  const subTotal = useMemo(() => {
    return rows.reduce((acc, r) => {
      const p = products.find((x) => x.id === r.productId);
      const q = Number(r.quantity);
      return acc + (p && q > 0 ? p.price * q : 0);
    }, 0);
  }, [rows, products]);

  const addRow = () =>
    setRows((r) => [...r, { productId: '', quantity: '1' }]);
  const removeRow = (i: number) =>
    setRows((r) => (r.length > 1 ? r.filter((_, idx) => idx !== i) : r));
  const updateRow = (
    i: number,
    patch: Partial<{ productId: string; quantity: string }>
  ) => setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const items = rows
      .filter((r) => r.productId && Number(r.quantity) > 0)
      .map((r) => ({ productId: r.productId, quantity: Number(r.quantity) }));

    if (items.length === 0) {
      setError('Selecciona al menos un producto con cantidad.');
      return;
    }

    setSaving(true);
    try {
      await api.sales.add({ items, note: note.trim() || undefined });
      setSuccess('Venta registrada correctamente.');
      setRows([{ productId: '', quantity: '1' }]);
      setNote('');
      setShowForm(false);
      loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrar la venta');
    } finally {
      setSaving(false);
    }
  };

  const statCards = [
    {
      label: 'Ventas de hoy',
      value: stats ? String(stats.todayCount) : '—',
      icon: Calendar,
      tint: 'bg-brand-100 text-brand-600',
    },
    {
      label: 'Ventas totales',
      value: stats ? String(stats.totalSales) : '—',
      icon: ShoppingCart,
      tint: 'bg-accent-100 text-accent-600',
    },
    {
      label: 'Ingresos de hoy',
      value: stats ? fmt(stats.todayRevenue) : '—',
      icon: Wallet,
      tint: 'bg-emerald-100 text-emerald-600',
    },
    {
      label: 'Ingresos totales',
      value: stats ? fmt(stats.totalRevenue) : '—',
      icon: DollarSign,
      tint: 'bg-indigo-100 text-indigo-600',
    },
  ];

  if (loading && !stats) {
    return (
      <div className="card p-10 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card p-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-r from-brand-600 to-accent-500 flex items-center justify-center shadow-soft">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-extrabold text-surface-900">Mis Ventas</h3>
            <p className="text-sm text-surface-500">
              Registra tus ventas y mira tus ganancias
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className={showForm ? 'btn-ghost text-sm' : 'btn-primary text-sm'}
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Cancelar' : 'Registrar Venta'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card p-6 space-y-4 border-accent-200">
          {error && (
            <div className="p-3 bg-accent-50 border border-accent-200 rounded-xl text-sm text-accent-600">
              {error}
            </div>
          )}
          {success && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-600">
              {success}
            </div>
          )}

          <div className="space-y-3">
            {rows.map((row, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_110px_auto] gap-2 items-end">
                <div>
                  <label className="block text-xs font-semibold text-surface-600 mb-1">
                    Producto
                  </label>
                  <select
                    value={row.productId}
                    onChange={(e) => updateRow(i, { productId: e.target.value })}
                    className="input"
                  >
                    <option value="">Selecciona un producto...</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {fmt(p.price)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-surface-600 mb-1">
                    Cantidad
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={row.quantity}
                    onChange={(e) => updateRow(i, { quantity: e.target.value })}
                    className="input"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="p-2.5 rounded-lg text-surface-400 hover:text-accent-500 hover:bg-accent-50"
                  aria-label="Quitar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <button type="button" onClick={addRow} className="btn-ghost text-sm">
              <Plus className="w-4 h-4" />
              Agregar producto
            </button>
            <p className="text-sm text-surface-600">
              Subtotal:{' '}
              <span className="font-extrabold text-brand-600">{fmt(subTotal)}</span>
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-surface-700 mb-1.5">
              Nota (opcional)
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="input"
              placeholder="Ej. Venta por Messenger, venta en punto, etc."
            />
          </div>

          <button type="submit" disabled={saving} className="btn-primary w-full">
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Registrando...
              </>
            ) : (
              <>
                <DollarSign className="w-4 h-4" />
                Registrar venta por {fmt(subTotal)}
              </>
            )}
          </button>
        </form>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <div key={card.label} className="card p-5">
            <div
              className={`w-10 h-10 rounded-xl ${card.tint} flex items-center justify-center mb-3`}
            >
              <card.icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-extrabold text-surface-900 truncate">
              {card.value}
            </p>
            <p className="text-xs font-semibold text-surface-500 mt-0.5">
              {card.label}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Trophy className="w-5 h-5 text-accent-500" />
            <h4 className="font-extrabold text-surface-900">Productos más vendidos</h4>
          </div>
          {!stats || stats.topProducts.length === 0 ? (
            <p className="text-sm text-surface-400 text-center py-6">
              Aún no hay ventas registradas.
            </p>
          ) : (
            <div className="space-y-3">
              {stats.topProducts.map((p, i) => (
                <div key={p.productId || i} className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-extrabold">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-surface-900 text-sm truncate">
                      {p.name}
                    </p>
                    <div className="h-1.5 bg-surface-100 rounded-full mt-1">
                      <div
                        className="h-1.5 bg-gradient-to-r from-brand-500 to-accent-500 rounded-full"
                        style={{
                          width: `${Math.min(
                            100,
                            (p.quantity / (stats.topProducts[0]?.quantity || 1)) * 100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                  <span className="text-sm font-bold text-surface-700">
                    {p.quantity} unid.
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Eye className="w-5 h-5 text-brand-500" />
            <h4 className="font-extrabold text-surface-900">Productos más vistos</h4>
          </div>
          {!stats || stats.topViewed.length === 0 ? (
            <p className="text-sm text-surface-400 text-center py-6">
              Comparte tu tienda para que los clientes vean tus productos.
            </p>
          ) : (
            <div className="space-y-3">
              {stats.topViewed.map((p, i) => (
                <div key={p.productId || i} className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-extrabold">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-surface-900 text-sm truncate">
                      {p.name}
                    </p>
                    <div className="h-1.5 bg-surface-100 rounded-full mt-1">
                      <div
                        className="h-1.5 bg-gradient-to-r from-brand-500 to-accent-500 rounded-full"
                        style={{
                          width: `${Math.min(
                            100,
                            (p.views / (stats.topViewed[0]?.views || 1)) * 100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                  <span className="text-sm font-bold text-surface-700">
                    {p.views} vistas
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Percent className="w-5 h-5 text-accent-500" />
            <h4 className="font-extrabold text-surface-900">Tasa de conversión</h4>
          </div>
          <>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-surface-50 rounded-2xl p-5 text-center">
                  <p className="text-3xl font-extrabold text-accent-600">
                    {stats ? fmtPct(stats.conversionRate) : '—'}
                  </p>
                  <p className="text-xs font-semibold text-surface-500 mt-1">
                    Ventas / Vistas
                  </p>
                </div>
                <div className="bg-surface-50 rounded-2xl p-5 text-center">
                  <p className="text-3xl font-extrabold text-brand-600">
                    {stats?.totalViews ?? '—'}
                  </p>
                  <p className="text-xs font-semibold text-surface-500 mt-1">
                    Vistas totales
                  </p>
                </div>
              </div>
              <p className="text-xs text-surface-400 mt-4">
                Cada vez que un cliente ve un producto de tu tienda cuenta como una vista.
                La conversión mide cuántas de esas vistas terminan en venta.
              </p>
            </>
        </div>

        <div className="card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Package className="w-5 h-5 text-brand-500" />
            <h4 className="font-extrabold text-surface-900">Resumen del negocio</h4>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-surface-50 rounded-xl py-4">
              <p className="text-2xl font-extrabold text-surface-900">
                {stats?.productCount ?? '—'}
              </p>
              <p className="text-xs font-semibold text-surface-500">Productos</p>
            </div>
            <div className="bg-surface-50 rounded-xl py-4">
              <p className="text-2xl font-extrabold text-accent-600">
                {stats?.customerCount ?? '—'}
              </p>
              <p className="text-xs font-semibold text-surface-500">Clientes</p>
            </div>
            <div className="bg-surface-50 rounded-xl py-4">
              <p className="text-2xl font-extrabold text-brand-600">
                {stats?.todayCount ?? '—'}
              </p>
              <p className="text-xs font-semibold text-surface-500">Ventas hoy</p>
            </div>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-center gap-2 mb-4">
          <ShoppingCart className="w-5 h-5 text-brand-500" />
          <h4 className="font-extrabold text-surface-900">Ventas recientes</h4>
        </div>
        {!stats || stats.recentSales.length === 0 ? (
          <p className="text-sm text-surface-400 text-center py-6">
            Registra tu primera venta para verla aquí.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto -mx-6 px-6 md:hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-bold text-surface-400 uppercase tracking-wide border-b border-surface-200">
                    <th className="py-2 pr-4">Fecha</th>
                    <th className="py-2 pr-4">Productos</th>
                    <th className="py-2 pr-4">Nota</th>
                    <th className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAllSales ? stats.recentSales : stats.recentSales.slice(0, 5)).map((s) => (
                    <SalesRow key={s.id} s={s} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto -mx-6 px-6 hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-bold text-surface-400 uppercase tracking-wide border-b border-surface-200">
                    <th className="py-2 pr-4">Fecha</th>
                    <th className="py-2 pr-4">Productos</th>
                    <th className="py-2 pr-4">Nota</th>
                    <th className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentSales.map((s) => (
                    <SalesRow key={s.id} s={s} />
                  ))}
                </tbody>
              </table>
            </div>
            {stats.recentSales.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAllSales((v) => !v)}
                className="md:hidden mt-4 w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-bold text-brand-600 bg-brand-50 border border-brand-100 rounded-xl hover:bg-brand-100 transition-colors"
              >
                {showAllSales ? (
                  <>
                    Ver menos
                    <ChevronUp className="w-4 h-4" />
                  </>
                ) : (
                  <>
                    Ver más ({stats.recentSales.length - 5} más)
                    <ChevronDown className="w-4 h-4" />
                  </>
                )}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SalesRow({ s }: { s: RecentSale }) {
  return (
    <tr className="border-b border-surface-100 last:border-0">
      <td className="py-3 pr-4 text-surface-600 whitespace-nowrap">
        {new Date(s.soldAt).toLocaleDateString('es-CO', {
          day: '2-digit',
          month: 'short',
        })}
      </td>
      <td className="py-3 pr-4">
        <div className="flex flex-wrap gap-1">
          {s.itemsSummary.map((it, i) => (
            <span
              key={i}
              className="px-2 py-0.5 bg-surface-100 text-surface-600 rounded-full text-xs font-medium"
            >
              {it.quantity} × {it.name}
            </span>
          ))}
        </div>
      </td>
      <td className="py-3 pr-4 text-surface-500">{s.note ?? '—'}</td>
      <td className="py-3 text-right font-bold text-surface-900 whitespace-nowrap">
        {fmt(s.total)}
      </td>
    </tr>
  );
}