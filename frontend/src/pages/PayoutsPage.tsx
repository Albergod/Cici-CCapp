import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  Landmark,
  Loader2,
  Plus,
  ShieldCheck,
  TriangleAlert,
  Wallet,
  X,
} from 'lucide-react';
import {
  api,
  LedgerBalance,
  MerchantBankAccount,
  PayoutRow,
} from '@/services/api';
import { formatCOP } from '@/lib/format';

const PAYOUT_LABEL: Record<string, string> = {
  PREPARED: 'Preparada',
  SENT: 'Enviada',
  PROCESSING: 'En proceso',
  SUCCESS: 'Pagada',
  FAILED: 'Fallida',
  CANCELLED: 'Cancelada',
};

export function PayoutsPage() {
  const [balance, setBalance] = useState<LedgerBalance | null>(null);
  const [accounts, setAccounts] = useState<MerchantBankAccount[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [bankCode, setBankCode] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountType, setAccountType] = useState<'AHORROS' | 'CORRIENTE'>('AHORROS');
  const [accountNumber, setAccountNumber] = useState('');
  const [holderName, setHolderName] = useState('');
  const [holderDocType, setHolderDocType] = useState<'CC' | 'CE' | 'NIT' | 'PP'>('CC');
  const [holderDoc, setHolderDoc] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [b, a, p] = await Promise.all([
        api.payouts.balance(),
        api.payouts.bankAccounts(),
        api.payouts.list(),
      ]);
      setBalance(b);
      setAccounts(a);
      setPayouts(p);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar tus cobros.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    document.title = 'Mis cobros · CC Platform';
    void load();
  }, []);

  const addAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.payouts.createBankAccount({
        bankCode: bankCode.trim(),
        bankName: bankName.trim() || undefined,
        accountType,
        accountNumber: accountNumber.replace(/\D/g, ''),
        holderName: holderName.trim(),
        holderDocType,
        holderDoc: holderDoc.replace(/\D/g, '') || undefined,
        isDefault: accounts.length === 0,
      });
      setShowForm(false);
      setBankCode('');
      setBankName('');
      setAccountNumber('');
      setHolderName('');
      setHolderDoc('');
      setMsg('Cuenta registrada. El número quedó cifrado.');
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'No se pudo registrar la cuenta.');
    } finally {
      setBusy(false);
    }
  };

  const requestPayout = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const row = await api.payouts.request();
      setMsg(`Liquidación de ${formatCOP(Number(row.amount))} preparada.`);
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'No se pudo solicitar la liquidación.');
    } finally {
      setBusy(false);
    }
  };

  const markPaid = async (id: string) => {
    const ref = window.prompt('Referencia o comprobante de la transferencia (opcional):', '') ?? '';
    setBusy(true);
    setMsg(null);
    try {
      await api.payouts.markPaid(id, ref.trim() || undefined);
      setMsg('Liquidación confirmada como pagada.');
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'No se pudo confirmar la liquidación.');
    } finally {
      setBusy(false);
    }
  };

  const failPayout = async (id: string) => {
    const reason = window.prompt('Motivo del fallo (mínimo 3 letras):', '') ?? '';
    if (reason.trim().length < 3) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.payouts.fail(id, reason.trim());
      setMsg('Liquidación fallida. El saldo volvió a disponible.');
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'No se pudo marcar como fallida.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen pt-[7.5rem] md:pt-16 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen pt-[7.5rem] md:pt-16 flex items-center justify-center px-4">
        <div className="card p-8 text-center max-w-md">
          <TriangleAlert className="w-8 h-8 text-amber-500 mx-auto mb-3" />
          <p className="text-surface-700 font-medium">{error}</p>
          <Link to="/dashboard" className="btn-primary mt-5 inline-flex">
            Ir a mi tienda
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-[7.5rem] md:pt-16">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-900 mb-5">
          <ArrowLeft className="w-4 h-4" />
          Volver al panel
        </Link>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-bold text-surface-900 tracking-tight">
              Mis cobros
            </h1>
            <p className="text-sm text-surface-500 mt-1">
              Saldo reconstruido desde el ledger de Cici Payments.
            </p>
          </div>
          <button
            onClick={requestPayout}
            disabled={busy || !balance?.available}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Wallet className="w-4 h-4" />
            Solicitar liquidación
          </button>
        </div>

        {msg && (
          <p className="mt-4 rounded-xl bg-brand-50 border border-brand-100 p-3 text-sm text-brand-700">
            {msg}
          </p>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
          {[
            { label: 'Disponible', value: balance?.available ?? 0, tone: 'text-emerald-600' },
            { label: 'En tránsito', value: balance?.inTransfer ?? 0, tone: 'text-amber-600' },
            { label: 'Pendiente', value: balance?.pending ?? 0, tone: 'text-surface-600' },
            { label: 'Pagado', value: balance?.paidOut ?? 0, tone: 'text-brand-600' },
          ].map((item) => (
            <div key={item.label} className="card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-surface-400">
                {item.label}
              </p>
              <p className={`mt-1 text-lg font-bold ${item.tone}`}>{formatCOP(item.value)}</p>
            </div>
          ))}
        </div>

        <section className="card p-5 md:p-6 mt-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold text-surface-900 flex items-center gap-2">
              <Landmark className="w-5 h-5 text-brand-600" />
              Cuentas bancarias
            </h2>
            <button onClick={() => setShowForm((v) => !v)} className="btn-secondary inline-flex items-center gap-1.5">
              <Plus className="w-4 h-4" />
              Agregar
            </button>
          </div>

          {accounts.length === 0 && !showForm ? (
            <p className="mt-4 text-sm text-surface-500">
              Registra una cuenta para poder solicitar liquidaciones.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {accounts.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-surface-200 p-3">
                  <div className="min-w-0">
                    <p className="font-medium text-surface-900 truncate">
                      {a.bankName || `Banco ${a.bankCode}`} · {a.accountType}
                    </p>
                    <p className="text-sm text-surface-500">
                      •••• {a.accountLast4} · {a.holderName}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {a.isDefault && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-md px-2 py-0.5">
                        Principal
                      </span>
                    )}
                    <button
                      onClick={async () => {
                        if (!window.confirm('¿Eliminar esta cuenta bancaria?')) return;
                        try {
                          await api.payouts.deleteBankAccount(a.id);
                          await load();
                        } catch (err) {
                          setMsg(err instanceof Error ? err.message : 'No se pudo eliminar.');
                        }
                      }}
                      className="p-1.5 text-surface-400 hover:text-accent-600"
                      aria-label="Eliminar cuenta"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showForm && (
            <form onSubmit={addAccount} className="mt-4 grid sm:grid-cols-2 gap-3 rounded-xl bg-surface-50 p-4">
              <label className="block">
                <span className="text-sm font-medium text-surface-700">Código del banco *</span>
                <input className="input mt-1" value={bankCode} onChange={(e) => setBankCode(e.target.value)} required />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-surface-700">Nombre del banco</span>
                <input className="input mt-1" value={bankName} onChange={(e) => setBankName(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-surface-700">Tipo de cuenta</span>
                <select className="input mt-1" value={accountType} onChange={(e) => setAccountType(e.target.value as 'AHORROS' | 'CORRIENTE')}>
                  <option value="AHORROS">Ahorros</option>
                  <option value="CORRIENTE">Corriente</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-surface-700">Número de cuenta *</span>
                <input
                  className="input mt-1"
                  inputMode="numeric"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                  required
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-surface-700">Titular *</span>
                <input className="input mt-1" value={holderName} onChange={(e) => setHolderName(e.target.value)} required />
              </label>
              <div className="grid grid-cols-[100px_1fr] gap-2">
                <label className="block">
                  <span className="text-sm font-medium text-surface-700">Doc.</span>
                  <select className="input mt-1" value={holderDocType} onChange={(e) => setHolderDocType(e.target.value as typeof holderDocType)}>
                    {['CC', 'CE', 'NIT', 'PP'].map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-surface-700">Número</span>
                  <input
                    className="input mt-1"
                    inputMode="numeric"
                    value={holderDoc}
                    onChange={(e) => setHolderDoc(e.target.value.replace(/\D/g, ''))}
                  />
                </label>
              </div>
              <div className="sm:col-span-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
                  Cancelar
                </button>
                <button type="submit" disabled={busy} className="btn-primary inline-flex items-center gap-2">
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  Guardar cuenta
                </button>
              </div>
            </form>
          )}
        </section>

        <section className="card p-5 md:p-6 mt-6">
          <h2 className="font-display text-lg font-bold text-surface-900 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            Historial de liquidaciones
          </h2>
          {payouts.length === 0 ? (
            <p className="mt-4 text-sm text-surface-500">Aún no hay liquidaciones.</p>
          ) : (
            <div className="mt-4 space-y-2">
              {payouts.map((p) => {
                const open = p.status === 'PREPARED' || p.status === 'SENT' || p.status === 'PROCESSING';
                return (
                  <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-200 p-3">
                    <div>
                      <p className="font-semibold text-surface-900">{formatCOP(Number(p.amount))}</p>
                      <p className="text-xs text-surface-400">
                        {new Date(p.createdAt).toLocaleString('es-CO')} · {PAYOUT_LABEL[p.status] ?? p.status}
                      </p>
                    </div>
                    {open && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => markPaid(p.id)}
                          disabled={busy}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                          Confirmar pago
                        </button>
                        <button
                          onClick={() => failPayout(p.id)}
                          disabled={busy}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-1.5 text-xs font-semibold text-surface-600 hover:bg-surface-50 disabled:opacity-50"
                        >
                          <X className="w-3.5 h-3.5" />
                          Falló
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
