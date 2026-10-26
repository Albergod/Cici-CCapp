import { useState, useCallback } from 'react';
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
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Ban,
  Building2,
} from 'lucide-react';
import { adminApi, adminLogin } from '@/services/api';
import { formatCOP } from '@/lib/format';

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

type ViolationRow = {
  id: string;
  type: string;
  severity: string;
  status: string;
  reason: string;
  resolvedNote: string | null;
  createdAt: string;
  store: { name: string; slug: string; storeStatus: string } | null;
  reporter: { name: string; email: string } | null;
};

type ViolationData = { rows: ViolationRow[]; total: number; page: number; totalPages: number };

type AdminStoreRow = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  suspensionEndsAt: string | null;
  sanctionsCount: number;
  banReason: string | null;
  openViolations: number;
  owner: { name: string; email: string } | null;
};

type AdminStoreData = { rows: AdminStoreRow[]; total: number; page: number; totalPages: number };

type EmpresariosLeadRow = {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string | null;
  storeCount: number | null;
  website: string | null;
  message: string | null;
  source: string;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type EmpresariosLeadData = {
  rows: EmpresariosLeadRow[];
  total: number;
  page: number;
  totalPages: number;
};

const LEAD_STATUS_LABELS: Record<string, string> = {
  NEW: 'Nueva',
  CONTACTED: 'Contactada',
  QUALIFIED: 'Calificada',
  BETA: 'En beta',
  DISCARDED: 'Descartada',
};

const LEAD_STATUS_STYLES: Record<string, string> = {
  NEW: 'bg-sky-100 text-sky-700',
  CONTACTED: 'bg-amber-100 text-amber-700',
  QUALIFIED: 'bg-brand-100 text-brand-700',
  BETA: 'bg-emerald-100 text-emerald-700',
  DISCARDED: 'bg-surface-200 text-surface-600',
};

const VIOLATION_LABELS: Record<string, string> = {
  referral_farm: 'Granja de referidos',
  buyer_report: 'Reporte de comprador',
  off_platform_chat: 'Pago/contacto por fuera',
  inflated_sale: 'Venta inflada',
  admin_action: 'Acción de admin',
};

const SEVERITY_STYLES: Record<string, string> = {
  info: 'bg-sky-100 text-sky-700',
  warning: 'bg-amber-100 text-amber-700',
  suspension: 'bg-orange-100 text-orange-700',
  ban: 'bg-red-100 text-red-700',
};

export function AdminPage() {
  const [step, setStep] = useState<'login' | 'loaded'>('login');
  const [tab, setTab] = useState<'resumen' | 'moderacion' | 'empresarios'>('resumen');
  const [sub, setSub] = useState<'violaciones' | 'tiendas'>('violaciones');
  const [stats, setStats] = useState<Stats | null>(null);
  const [payments, setPayments] = useState<PaymentData | null>(null);
  const [violations, setViolations] = useState<ViolationData | null>(null);
  const [violFilter, setViolFilter] = useState<'OPEN' | 'RESOLVED' | ''>('OPEN');
  const [adminStores, setAdminStores] = useState<AdminStoreData | null>(null);
  const [storeFilter, setStoreFilter] = useState<'SUSPENDED' | 'BANNED' | 'ACTIVE' | ''>('SUSPENDED');
  const [empresariosLeads, setEmpresariosLeads] = useState<EmpresariosLeadData | null>(null);
  const [leadFilter, setLeadFilter] = useState<'NEW' | 'CONTACTED' | 'QUALIFIED' | 'BETA' | 'DISCARDED' | ''>('NEW');
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState('');

  const loadModeration = useCallback(
    async (violationState: string, storeState: string) => {
      const [v, s] = await Promise.all([
        adminApi.violations({ status: violationState }),
        adminApi.adminStores({ status: storeState }),
      ]);
      setViolations(v);
      setAdminStores(s);
    },
    [],
  );

  const handleLogin = async () => {
    const token = (tokenInput.trim() || localStorage.getItem('adminToken') || '').trim();
    if (!token) {
      setError('Escribe tu token de administrador (es el valor de ADMIN_TOKEN en el entorno del servidor).');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Canjea el ADMIN_TOKEN por un JWT corto. Si lo pegado ya es un JWT
      // vigente, el login falla y se usa tal cual.
      let session = token;
      try {
        session = await adminLogin(token);
      } catch {
        /* puede ser un JWT ya emitido */
      }
      localStorage.setItem('adminToken', session);
      const [statsData, paymentsData, leadsData] = await Promise.all([
        adminApi.stats(),
        adminApi.payments(),
        adminApi.empresariosLeads({ status: 'NEW' }),
      ]);
      setStats(statsData);
      setPayments(paymentsData);
      setEmpresariosLeads(leadsData);
      await loadModeration('OPEN', 'SUSPENDED');
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
      const [statsData, paymentsData, leadsData] = await Promise.all([
        adminApi.stats(),
        adminApi.payments(),
        adminApi.empresariosLeads({ status: leadFilter }),
      ]);
      setStats(statsData);
      setPayments(paymentsData);
      setEmpresariosLeads(leadsData);
      await loadModeration(violFilter, storeFilter);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const loadViolations = async (status: string, page = 1) => {
    const data = await adminApi.violations({ status, page });
    setViolations(data);
  };

  const loadPaymentsPage = async (page: number) => {
    setLoading(true);
    try {
      const data = await adminApi.payments(page);
      setPayments(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const loadAdminStores = async (status: string, page = 1) => {
    const data = await adminApi.adminStores({ status, page });
    setAdminStores(data);
  };

  const loadLeads = async (status: string, page = 1) => {
    const data = await adminApi.empresariosLeads({ status, page });
    setEmpresariosLeads(data);
  };

  const updateLead = async (id: string, body: { status?: string; notes?: string }) => {
    setPendingId(id);
    try {
      await adminApi.updateEmpresariosLead(id, body);
      await loadLeads(leadFilter, 1);
    } catch {
      /* ignore */
    } finally {
      setPendingId(null);
    }
  };

  const editLeadNotes = async (row: EmpresariosLeadRow) => {
    const notes = window.prompt(`Nota interna para ${row.companyName}:`, row.notes ?? '');
    if (notes === null) return;
    await updateLead(row.id, { notes });
  };

  const resolveViolation = async (id: string) => {
    setPendingId(id);
    try {
      await adminApi.resolveViolation(id, { status: 'RESOLVED', note: 'Revisado y cerrado desde el panel' });
      await loadViolations(violFilter);
      await loadAdminStores(storeFilter);
    } catch {
      /* ignore */
    } finally {
      setPendingId(null);
    }
  };

  const suspendStore = async (row: AdminStoreRow) => {
    const days = window.prompt(`Suspender "${row.name}" por N días (14 sugerido):`, '14');
    if (!days) return;
    const reason = window.prompt('Motivo de la suspensión:', '') ?? '';
    if (!reason.trim()) return;
    setPendingId(row.id);
    try {
      await adminApi.suspendStore(row.id, { days: Number(days) || 14, reason });
      await loadAdminStores(storeFilter);
    } catch {
      /* ignore */
    } finally {
      setPendingId(null);
    }
  };

  const banStore = async (row: AdminStoreRow) => {
    const reason = window.prompt(`Vetar "${row.name}" permanentemente. Motivo:`, '') ?? '';
    if (!reason.trim()) return;
    setPendingId(row.id);
    try {
      await adminApi.banStore(row.id, { reason });
      await loadAdminStores(storeFilter);
    } catch {
      /* ignore */
    } finally {
      setPendingId(null);
    }
  };

  const unbanStore = async (row: AdminStoreRow) => {
    setPendingId(row.id);
    try {
      await adminApi.unbanStore(row.id, { reason: 'Reactivada por el administrador' });
      await loadAdminStores(storeFilter);
    } catch {
      /* ignore */
    } finally {
      setPendingId(null);
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

  const storeStatusBadge = (row: AdminStoreRow) => {
    if (row.status === 'BANNED') return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Vetada</span>;
    if (row.status === 'SUSPENDED')
      return (
        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
          Suspendida {row.suspensionEndsAt ? `hasta ${new Date(row.suspensionEndsAt).toLocaleDateString()}` : ''}
        </span>
      );
    return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Activa</span>;
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
      <div className="flex items-center justify-between mb-6">
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

      <div className="flex gap-2 mb-8">
        <button
          onClick={() => setTab('resumen')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${tab === 'resumen' ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}
        >
          Resumen
        </button>
        <button
          onClick={() => setTab('moderacion')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 ${tab === 'moderacion' ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}
        >
          <ShieldAlert className="w-4 h-4" />
          Moderación
          {violations && violations.rows.length > 0 && (
            <span className="text-xs font-bold bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center">
              {violations.rows.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('empresarios')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 ${tab === 'empresarios' ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}
        >
          <Building2 className="w-4 h-4" />
          Empresarios
        </button>
      </div>

      {tab === 'resumen' ? (
        <>
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
              <div className="p-8 text-center text-sm text-surface-500">No hay pagos registrados todavía.</div>
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
                        <p className="text-sm font-bold text-surface-900">{formatCOP(p.amount)}</p>
                        <p className="text-xs text-surface-500">{statusLabel(p.status)}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between p-4 border-t border-surface-100">
                  <button
                    onClick={() => loadPaymentsPage(payments.page - 1)}
                    disabled={payments.page <= 1 || loading}
                    className="btn-outline text-sm px-4 py-2 disabled:opacity-40"
                  >
                    ← Anterior
                  </button>
                  <span className="text-sm text-surface-600">{payments.page} / {payments.totalPages}</span>
                  <button
                    onClick={() => loadPaymentsPage(payments.page + 1)}
                    disabled={payments.page >= payments.totalPages || loading}
                    className="btn-outline text-sm px-4 py-2 disabled:opacity-40"
                  >
                    Siguiente →
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      ) : tab === 'moderacion' ? (
        <>
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => { setSub('violaciones'); if (violations) loadViolations(violFilter); }}
              className={`px-3 py-2 rounded-lg text-sm font-semibold ${sub === 'violaciones' ? 'bg-surface-800 text-white' : 'bg-surface-100 text-surface-600'}`}
            >
              Violaciones ({violations?.total ?? 0})
            </button>
            <button
              onClick={() => { setSub('tiendas'); if (adminStores) loadAdminStores(storeFilter); }}
              className={`px-3 py-2 rounded-lg text-sm font-semibold ${sub === 'tiendas' ? 'bg-surface-800 text-white' : 'bg-surface-100 text-surface-600'}`}
            >
              Tiendas sancionadas ({adminStores?.rows.length ?? 0})
            </button>
          </div>

          {sub === 'violaciones' ? (
            <div className="card overflow-hidden">
              <div className="p-5 border-b border-surface-100 flex items-center justify-between gap-3 flex-wrap">
                <h2 className="font-display text-lg font-extrabold text-surface-900">Violaciones anti-fraude</h2>
                <div className="flex gap-1">
                  {(['', 'OPEN', 'RESOLVED'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={async () => { setViolFilter(s); await loadViolations(s); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${violFilter === s ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-600'}`}
                    >
                      {s === '' ? 'Todas' : s === 'OPEN' ? 'Abiertas' : 'Resueltas'}
                    </button>
                  ))}
                </div>
              </div>
              {!violations || violations.rows.length === 0 ? (
                <div className="p-8 text-center text-sm text-surface-500">
                  <ShieldCheck className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
                  No hay violaciones con este filtro. ¡Todo en orden!
                </div>
              ) : (
                <div className="divide-y divide-surface-100">
                  {violations.rows.map((v) => (
                    <div key={v.id} className="p-4 hover:bg-surface-50 transition-colors">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${SEVERITY_STYLES[v.severity] ?? 'bg-surface-100 text-surface-600'}`}>
                              {v.severity}
                            </span>
                            <span className="text-sm font-bold text-surface-900">{VIOLATION_LABELS[v.type] ?? v.type}</span>
                            <span className="text-xs text-surface-500">{new Date(v.createdAt).toLocaleString()}</span>
                            {v.store && <span className="text-xs text-surface-500">→ {v.store.name}</span>}
                          </div>
                          <p className="text-sm text-surface-700 mt-1">{v.reason}</p>
                          {v.reporter && (
                            <p className="text-xs text-surface-500 mt-0.5">Reportado por {v.reporter.name} ({v.reporter.email})</p>
                          )}
                          {v.resolvedNote && <p className="text-xs text-emerald-600 mt-1">✓ {v.resolvedNote}</p>}
                        </div>
                        {v.status === 'OPEN' && (
                          <button
                            onClick={() => resolveViolation(v.id)}
                            disabled={pendingId === v.id}
                            className="btn-outline text-xs px-3 py-1.5 flex items-center gap-1 shrink-0"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Revisado
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="p-5 border-b border-surface-100 flex items-center justify-between gap-3 flex-wrap">
                <h2 className="font-display text-lg font-extrabold text-surface-900">Tiendas con sanciones</h2>
                <div className="flex gap-1">
                  {(['SUSPENDED', 'BANNED', 'ACTIVE', ''] as const).map((s) => (
                    <button
                      key={s}
                      onClick={async () => { setStoreFilter(s); await loadAdminStores(s); }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${storeFilter === s ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-600'}`}
                    >
                      {s === '' ? 'Todas' : s === 'SUSPENDED' ? 'Suspendidas' : s === 'BANNED' ? 'Vetadas' : 'Activas'}
                    </button>
                  ))}
                </div>
              </div>
              {!adminStores || adminStores.rows.length === 0 ? (
                <div className="p-8 text-center text-sm text-surface-500">
                  <ShieldCheck className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
                  No hay tiendas con este estado.
                </div>
              ) : (
                <div className="divide-y divide-surface-100">
                  {adminStores.rows.map((row) => (
                    <div key={row.id} className="p-4 hover:bg-surface-50 transition-colors">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="text-sm font-bold text-surface-900">{row.name}</span>
                            {storeStatusBadge(row)}
                            {row.openViolations > 0 && (
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                                {row.openViolations} abiertas
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-surface-500 mt-0.5">
                            {row.owner ? `${row.owner.name} · ${row.owner.email}` : '—'} · Plan {row.plan} · {row.sanctionsCount} sanción(es)
                          </p>
                          {row.banReason && <p className="text-xs text-red-600 mt-0.5">Motivo del veto: {row.banReason}</p>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {row.status === 'ACTIVE' ? (
                            <button
                              onClick={() => suspendStore(row)}
                              disabled={pendingId === row.id}
                              className="btn-outline text-xs px-3 py-1.5 flex items-center gap-1"
                            >
                              <AlertTriangle className="w-3.5 h-3.5" />
                              Suspender
                            </button>
                          ) : (
                            <>
                              {row.status !== 'BANNED' && (
                                <button
                                  onClick={() => banStore(row)}
                                  disabled={pendingId === row.id}
                                  className="btn-outline text-xs px-3 py-1.5 flex items-center gap-1 text-red-600"
                                >
                                  <Ban className="w-3.5 h-3.5" />
                                  Vetar
                                </button>
                              )}
                              <button
                                onClick={() => unbanStore(row)}
                                disabled={pendingId === row.id}
                                className="btn-outline text-xs px-3 py-1.5 flex items-center gap-1"
                              >
                                <ShieldCheck className="w-3.5 h-3.5" />
                                Reactivar
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex gap-1.5 mb-6 flex-wrap">
            {(['NEW', 'CONTACTED', 'QUALIFIED', 'BETA', 'DISCARDED', ''] as const).map((status) => (
              <button
                key={status || 'ALL'}
                onClick={async () => {
                  setLeadFilter(status);
                  await loadLeads(status);
                }}
                className={`px-3 py-2 rounded-lg text-xs font-semibold ${
                  leadFilter === status ? 'bg-brand-600 text-white' : 'bg-surface-100 text-surface-600'
                }`}
              >
                {status === '' ? 'Todas' : LEAD_STATUS_LABELS[status]}
              </button>
            ))}
          </div>

          <div className="card overflow-hidden">
            <div className="p-5 border-b border-surface-100 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-display text-lg font-extrabold text-surface-900">
                  Solicitudes de Cici Empresarios
                </h2>
                <p className="text-xs text-surface-500 mt-1">
                  {empresariosLeads?.total ?? 0} solicitudes con este filtro — página{' '}
                  {empresariosLeads?.page ?? 1} de {empresariosLeads?.totalPages ?? 1}
                </p>
              </div>
              <Building2 className="w-6 h-6 text-brand-600" />
            </div>

            {!empresariosLeads || empresariosLeads.rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-surface-500">
                <Building2 className="w-8 h-8 mx-auto mb-2 text-surface-300" />
                No hay solicitudes con este estado.
              </div>
            ) : (
              <>
                <div className="divide-y divide-surface-100">
                  {empresariosLeads.rows.map((row) => (
                    <div key={row.id} className="p-4 hover:bg-surface-50 transition-colors">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-surface-900">{row.companyName}</span>
                            <span
                              className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                                LEAD_STATUS_STYLES[row.status] ?? 'bg-surface-100 text-surface-600'
                              }`}
                            >
                              {LEAD_STATUS_LABELS[row.status] ?? row.status}
                            </span>
                            <span className="text-xs text-surface-400">
                              {new Date(row.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-xs text-surface-600 mt-1">
                            {row.contactName} ·{' '}
                            <a href={`mailto:${row.email}`} className="text-brand-600 hover:underline">
                              {row.email}
                            </a>
                            {row.phone ? ` · ${row.phone}` : ''}
                            {row.storeCount ? ` · ${row.storeCount} tienda(s)` : ''}
                          </p>
                          {row.website && (
                            <a
                              href={row.website}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-brand-600 hover:underline"
                            >
                              {row.website}
                            </a>
                          )}
                          {row.message && (
                            <p className="text-sm text-surface-700 mt-2 whitespace-pre-wrap">{row.message}</p>
                          )}
                          {row.notes && (
                            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 mt-2">
                              Nota interna: {row.notes}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <select
                            value={row.status}
                            onChange={(e) => updateLead(row.id, { status: e.target.value })}
                            disabled={pendingId === row.id}
                            className="text-xs font-semibold bg-surface-50 border border-surface-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                          >
                            {(['NEW', 'CONTACTED', 'QUALIFIED', 'BETA', 'DISCARDED'] as const).map((status) => (
                              <option key={status} value={status}>
                                {LEAD_STATUS_LABELS[status]}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => editLeadNotes(row)}
                            disabled={pendingId === row.id}
                            className="btn-outline text-xs px-3 py-1.5"
                          >
                            Nota
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between p-4 border-t border-surface-100">
                  <button
                    onClick={() => loadLeads(leadFilter, (empresariosLeads?.page ?? 1) - 1)}
                    disabled={(empresariosLeads?.page ?? 1) <= 1 || loading}
                    className="btn-outline text-sm px-4 py-2 disabled:opacity-40"
                  >
                    ← Anterior
                  </button>
                  <span className="text-sm text-surface-600">
                    {empresariosLeads?.page ?? 1} / {empresariosLeads?.totalPages ?? 1}
                  </span>
                  <button
                    onClick={() => loadLeads(leadFilter, (empresariosLeads?.page ?? 1) + 1)}
                    disabled={(empresariosLeads?.page ?? 1) >= (empresariosLeads?.totalPages ?? 1) || loading}
                    className="btn-outline text-sm px-4 py-2 disabled:opacity-40"
                  >
                    Siguiente →
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}