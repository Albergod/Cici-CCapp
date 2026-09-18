import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  X,
  Crown,
} from 'lucide-react';

export type PaymentResultState =
  | { kind: 'success'; plan: 'PRO' | 'BUSINESS'; cycle: 'MONTHLY' | 'BI_MONTHLY' }
  | { kind: 'pending' }
  | { kind: 'failure'; reason?: string }
  | null;

interface PaymentResultModalProps {
  open: PaymentResultState;
  onClose: () => void;
  onRetry: () => void;
}

export function PaymentResultModal({ open, onClose, onRetry }: PaymentResultModalProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
    } else {
      const t = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!visible || !open) return null;

  if (open.kind === 'success') {
    const features =
      open.plan === 'PRO'
        ? ['Sistema de prestigio y referidos', 'Check verificado', 'Hasta 100 productos']
        : ['Todo lo del plan Premium+', 'Hasta 500 productos', 'Máxima visibilidad'];
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 overflow-y-auto">
        <div className="absolute inset-0 bg-surface-900/50 backdrop-blur-sm" onClick={onClose} />
        <div className="card p-6 md:p-8 w-full max-w-lg relative shadow-lift my-8">
          <button onClick={onClose} aria-label="Cerrar" className="absolute top-3 right-3 p-2 rounded-full hover:bg-surface-100 text-surface-500">
            <X className="w-5 h-5" />
          </button>
          <div className="text-center">
            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-brand-600 to-accent-500 flex items-center justify-center mx-auto">
              <Crown className="w-8 h-8 text-white" />
            </div>
            <h2 className="font-display text-2xl font-extrabold text-surface-900 mt-4">¡Felicidades, tu espacio está activo!</h2>
            <p className="text-sm text-surface-500 mt-1.5">Tu pago fue confirmado. Disfruta del plan {open.plan} {open.cycle === 'MONTHLY' ? 'mensual' : 'bimensual'} con estas ventajas:</p>
          </div>
          <div className="mt-6 grid gap-2.5">
            {features.map(f => (
              <div key={f} className="flex items-start gap-3 p-3 rounded-2xl bg-surface-50 border border-surface-100">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
                <span className="text-sm text-surface-900">{f}</span>
              </div>
            ))}
          </div>
          <button onClick={onClose} className="btn-primary w-full mt-6">¡Empezar a vender!</button>
        </div>
      </div>
    );
  }

  if (open.kind === 'pending') {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 overflow-y-auto">
        <div className="absolute inset-0 bg-surface-900/50 backdrop-blur-sm" onClick={onClose} />
        <div className="card p-6 md:p-7 w-full max-w-md relative shadow-lift my-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
            <Clock className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-extrabold text-surface-900 mt-4">Pago en proceso</h2>
          <p className="text-sm text-surface-600 mt-2">
            Tu pago se está procesando con Mercado Pago. Puedes dejar la ventana abierta
            o volver más tarde. Cuando el pago sea confirmado, tu plan se activará automáticamente.
          </p>
          <div className="mt-5 flex flex-col gap-2.5">
            <button onClick={onClose} className="btn-primary w-full">Volver al dashboard</button>
            <button onClick={onRetry} className="w-full text-center text-sm font-semibold text-brand-600 hover:text-brand-700 py-2 rounded-lg transition-colors">
              <RefreshCw className="w-4 h-4 inline" /> Verificar estado
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (open.kind === 'failure') {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 overflow-y-auto">
        <div className="absolute inset-0 bg-surface-900/50 backdrop-blur-sm" onClick={onClose} />
        <div className="card p-6 md:p-7 w-full max-w-md relative shadow-lift my-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mx-auto">
            <XCircle className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-extrabold text-surface-900 mt-4">Pago rechazado</h2>
          <p className="text-sm text-surface-600 mt-2">
            {open.reason === 'not_found'
              ? 'No encontramos el pago. Asegúrate de haber completado el checkout en Mercado Pago.'
              : `Tu pago fue rechazado (${open.reason}). Puedes intentar de nuevo.`}
          </p>
          <div className="mt-5 flex flex-col gap-2.5">
            <button onClick={onRetry} className="btn-primary w-full">Reintentar pago</button>
            <button onClick={onClose} className="w-full text-center text-sm font-semibold text-surface-500 hover:text-surface-700 py-2 rounded-lg transition-colors">Cancelar</button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}