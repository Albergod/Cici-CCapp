import { useEffect, useState } from 'react';
import { Wallet, Loader2, Banknote } from 'lucide-react';
import { api } from '@/services/api';
import { formatCOP } from '@/lib/format';

interface HistoryRow {
  id: string;
  status: string;
  sellerNet: number | string;
  total: number | string;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  initiated: 'Iniciado',
  collected: 'Cobrado',
  held: 'Retenido',
  released: 'Liberado (listo para tu Nequi)',
  paid_out: 'Pagado',
  refunded: 'Devuelto',
  cancelled: 'Cancelado',
};

export function FinanzasPanel() {
  const [balance, setBalance] = useState<{ pending: number; paid: number } | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [report, setReport] = useState<{ rows: HistoryRow[]; total: number; count: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.protected.mine(), api.protected.payoutReport()])
      .then(([mine, rep]) => {
        setBalance(mine.balance);
        setHistory(mine.history as unknown as HistoryRow[]);
        setReport(rep as unknown as { rows: HistoryRow[]; total: number; count: number });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card p-6 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-brand-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
          <Wallet className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-extrabold text-surface-900">Pagos protegidos</h3>
          <p className="text-xs text-surface-500">
            Comisión 2.5% + 2.5% · se libera a las 48h · Nequi semanal.{' '}
            <a href="/como-funciona#tenderas" className="font-semibold text-brand-600 underline">
              ¿Cómo funciona?
            </a>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4">
          <p className="text-xs font-semibold text-amber-700">Por cobrar</p>
          <p className="text-2xl font-extrabold text-surface-900">{formatCOP(balance?.pending ?? 0)}</p>
        </div>
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4">
          <p className="text-xs font-semibold text-emerald-700">Ya pagado</p>
          <p className="text-2xl font-extrabold text-surface-900">{formatCOP(balance?.paid ?? 0)}</p>
        </div>
      </div>

      {report && report.count > 0 && (
        <div className="mt-4 rounded-2xl bg-surface-900 text-white p-4 flex items-center gap-3">
          <Banknote className="w-6 h-6 shrink-0" />
          <div className="text-sm">
            <strong>{formatCOP(report.total)}</strong> listos para tu próximo Nequi ({report.count} pago{report.count === 1 ? '' : 's'}).
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-4 space-y-2">
          {history.slice(0, 10).map((h) => (
            <div key={h.id} className="flex items-center justify-between text-sm py-2 border-b border-surface-100 last:border-0">
              <div>
                <span className="font-bold text-surface-900">{formatCOP(Number(h.sellerNet))}</span>
                <span className="text-surface-400 text-xs ml-2">
                  {new Date(h.createdAt).toLocaleDateString('es-CO')}
                </span>
              </div>
              <span className="text-xs font-bold text-surface-500">
                {STATUS_LABEL[h.status] ?? h.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
