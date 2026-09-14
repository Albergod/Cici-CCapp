import { useState } from 'react';
import {
  Key,
  RefreshCw,
  ArrowLeft,
  Store,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  CreditCard,
} from 'lucide-react';
import { adminApi } from '@/services/api';

type Stats = {
  totalStores: number;
  totalFree: number;
  totalPro: number;
  totalBusiness: number;
  totalPayments: number;
};

type PaymentRow = {
  id: string;
  status: string;
  plan: string;
  cycle: string;
  amount: number;
  processedAt: string;
};

type PaymentData = {
  rows: PaymentRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export function AdminPage() {
  const [step, setStep] = useState<'login' | 'loaded'>('login');
  const [stats, setStats] = useState<Stats | null>(null);
  const [payments, setPayments] = useState<PaymentData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [tokenInput, setTokenInput] = useState('');

  const handleLogin = async () => {
    const token = (tokenInput.trim() || localStorage.getItem('adminToken') || '').trim();
    if (!token) {
      setError('Escribe tu token de administrador (es el valor de ADMIN_TOKEN en el entorno del servidor).');
      return;
    }
    localStorage.setItem('adminToken', token);
    setLoading(true);
    setError(null);
    try {
      const statsData = await adminApi.stats();
      const paymentsData = await adminApi.payments();
      setStats(statsData);
      setPayments(paymentsData);
      setStep('loaded');
    } catch (err: unknown) {
      const msg = (err as Error).message;
      setError(msg.includes('403') ? 'Token inválido. Verifica que sea el ADMIN_TOKEN correcto.' : msg);
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    if (!stats) return;
    setLoading(true);
    try {
      const data = await adminApi.stats();
      setStats(data);
      const paymentsData = await adminApi.payments();
      setPayments(paymentsData);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const loadPaymentsPage = async (page: number) => {
    setLoadingPayments(true);
    try {
      const data = await adminApi.payments(page);
      setPayments(data);
    } catch {
      /* ignore */
    } finally {
      setLoadingPayments(false);
    }
  };

  const statusIcon = (status: string) => {
    if (status === 'approved') return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    if (status === 'pending' || status === 'in_process') return <Clock className="w-4 h-4 text-amber-500" />;
    return <XCircle className="w-4 h-4 text-red-500" />;
  };

  const statusLabel = (status: string) => {
    if (status === 'approved') return 'Aprobado';
    if (status === 'pending' || status === 'in_process') return 'Pendiente';
    return 'Rechazado';
  };

  if (step === 'login') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="card p-8 w-full max-w-md text-center">
          <div className="w-16 h-16 rounded-2xl bg-surface-100 flex items-center justify-center mx-auto">
            <Key className="w-8 h-8 text-surface-500" />
          </div>
          <h2 className="text-xl font-extrabold text-surface-900 mt-4">Panel de Administración</h2>
          <p className="text-sm text-surface-600 mt-2">
            Escribe el token de administrador (valor de <code className="text-xs font-mono">ADMIN_TOKEN</code> en el entorno del servidor).
          </p>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="ADMIN_TOKEN"
            className="mt-4 w-full p-3 bg-surface-50 rounded-xl text-sm font-mono border border-surface-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
          <button onClick={handleLogin} disabled={loading} className="btn-primary w-full mt-4">
            {loading ? 'Cargando...' : 'Conectar al panel'}
          </button>
        </div>
      </div>
    );
  }

  if (!stats || !payments) return null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <button onClick={() => setStep('login')} className="p-2 rounded-full hover:bg-surface-100">
            <ArrowLeft className="w-5 h-5 text-surface-500" />
          </button>
          <h1 className="font-display text-2xl font-extrabold text-surface-900">Panel de Administración</h1>
        </div>
        <button onClick={refresh} disabled={loading} className="btn-outline text-sm flex items-center gap-2">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="card p-5 text-center">
          <Store className="w-6 h-6 text-brand-600 mx-auto" />
          <p className="text-2xl font-extrabold text-surface-900 mt-2">{stats.totalStores}</p>
          <p className="text-xs text-surface-500">Tiendas totales</p>
        </div>
        <div className="card p-5 text-center">
          <Users className="w-6 h-6 text-surface-400 mx-auto" />
          <p className="text-2xl font-extrabold text-surface-900 mt-2">{stats.totalFree}</p>
          <p className="text-xs text-surface-500">Gratuitas</p>
        </div>
        <div className="card p-5 text-center">
          <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto" />
          <p className="text-2xl font-extrabold text-surface-900 mt-2">{stats.totalPro + stats.totalBusiness}</p>
          <p className="text-xs text-surface-500">Premium</p>
        </div>
        <div className="card p-5 text-center">
          <CreditCard className="w-6 h-6 text-amber-600 mx-auto" />
          <p className="text-2xl font-extrabold text-surface-900 mt-2">{stats.totalPayments}</p>
          <p className="text-xs text-surface-500">Pagos registrados</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-5 border-b border-surface-100">
          <h2 className="font-display text-lg font-extrabold text-surface-900">Pagos registrados</h2>
          <p className="text-xs text-surface-500 mt-1">{payments.total} pagos en total — página {payments.page} de {payments.totalPages}</p>
        </div>
        {payments.rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-surface-500">
            No hay pagos registrados todavía.
          </div>
        ) : (
          <>
            <div className="divide-y divide-surface-100">
              {payments.rows.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-4 hover:bg-surface-50 transition-colors">
                  <div className="flex items-center gap-4">
                    {statusIcon(p.status)}
                    <div>
                      <p className="text-sm font-semibold text-surface-900">{p.plan} — {p.cycle === 'MONTHLY' ? 'Mensual' : 'Bimensual'}</p>
                      <p className="text-xs text-surface-500">{p.id.slice(0, 8)}...</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-surface-900">${p.amount.toLocaleString()}</p>
                    <p className="text-xs text-surface-500">{statusLabel(p.status)}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between p-4 border-t border-surface-100">
              <button
                onClick={() => loadPaymentsPage(payments.page - 1)}
                disabled={payments.page <= 1 || loadingPayments}
                className="btn-outline text-sm px-4 py-2 disabled:opacity-40"
              >
                ← Anterior
              </button>
              <span className="text-sm text-surface-600">{payments.page} / {payments.totalPages}</span>
              <button
                onClick={() => loadPaymentsPage(payments.page + 1)}
                disabled={payments.page >= payments.totalPages || loadingPayments}
                className="btn-outline text-sm px-4 py-2 disabled:opacity-40"
              >
                Siguiente →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}