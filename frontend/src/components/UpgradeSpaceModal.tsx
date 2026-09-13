import { useEffect, useState } from 'react';
import {
  Loader2,
  AlertTriangle,
  Smartphone,
  CreditCard,
  ArrowLeft,
  Phone,
} from 'lucide-react';
import { SpacePlanModal, UpgradeSelection } from '@/components/SpacePlanModal';
import { PaymentResultState } from '@/components/PaymentResultModal';
import { api } from '@/services/api';

type UpgradeStep = 'plan' | 'method' | 'nequi' | 'nequi-pending' | 'checkout' | 'error';

interface UpgradeSpaceModalProps {
  open: boolean;
  storeId?: string;
  onClose: () => void;
  onPaymentResult?: (state: PaymentResultState) => void;
}

const NEQUI_POLL_MS = 4000;

export function UpgradeSpaceModal({ open, storeId, onClose, onPaymentResult }: UpgradeSpaceModalProps) {
  const [step, setStep] = useState<UpgradeStep>('plan');
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<UpgradeSelection | null>(null);
  const [phone, setPhone] = useState('');
  const [transactionId, setTransactionId] = useState<string | null>(null);

  useEffect(() => {
    if (step !== 'nequi-pending' || !transactionId) return;
    const t = setInterval(async () => {
      try {
        const result = await api.payments.wompiStatus(transactionId);
        if (result.approved) {
          clearInterval(t);
          onPaymentResult?.({ kind: 'success', plan: result.plan ?? 'PRO', cycle: result.cycle ?? 'MONTHLY' });
          handleClose();
        } else if (result.status === 'declined' || result.status === 'error' || result.status === 'voided' || result.status === 'not_found') {
          clearInterval(t);
          onPaymentResult?.({ kind: 'failure', reason: result.detail ?? result.status });
          handleClose();
        }
      } catch {
        // Sigue intentando: el webhook/poll puede tardar.
      }
    }, NEQUI_POLL_MS);
    return () => clearInterval(t);
  }, [step, transactionId]);

  if (!open) return null;

  const reset = () => {
    setStep('plan');
    setError(null);
    setSel(null);
    setPhone('');
    setTransactionId(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleUpgrade = async (selection: UpgradeSelection) => {
    setError(null);
    setSel(selection);
    setStep('method');
  };

  const handlePagarMercadoPago = async () => {
    if (!sel) return;
    setStep('checkout');
    try {
      const pref = await api.payments.createPreference(storeId ?? null, sel.plan, sel.cycle);
      // Redirige al usuario al checkout de Mercado Pago. Al volver, la app
      // verifica el pago contra Mercado Pago y activa el plan SOLO si fue
      // aprobado (ver DashboardPage).
      window.location.href = pref.initPoint;
    } catch (err) {
      setStep('error');
      setError(err instanceof Error ? err.message : 'No se pudo iniciar el pago.');
    }
  };

  const handlePagarNequi = async () => {
    if (!sel) return;
    if (!/^3\d{9}$/.test(phone.trim())) {
      setStep('error');
      setError('Ingresa un número Nequi válido de 10 dígitos, p.ej. 3101234567.');
      return;
    }
    setError(null);
    try {
      const res = await api.payments.createNequi(storeId ?? null, sel.plan, sel.cycle, phone.trim());
      setTransactionId(res.transactionId);
      setStep('nequi-pending');
    } catch (err) {
      setStep('error');
      setError(err instanceof Error ? err.message : 'No se pudo iniciar el pago por Nequi.');
    }
  };

  if (step === 'checkout') {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
        <div className="absolute inset-0 bg-surface-900/50 backdrop-blur-sm" />
        <div className="card p-6 md:p-7 w-full max-w-md relative shadow-lift my-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-brand-100 text-brand-600 flex items-center justify-center mx-auto">
            <Loader2 className="w-7 h-7 animate-spin" />
          </div>
          <h2 className="text-xl font-extrabold text-surface-900 mt-4">
            Redirigiendo a Mercado Pago
          </h2>
          <p className="text-sm text-surface-600 mt-2">
            Verás el resumen de tu pago y podrás pagar con tarjeta, PSE o tu
            medio favorito. Cuando completes el pago volverás por aquí con tu
            tienda actualizada.
          </p>
        </div>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
        <div className="absolute inset-0 bg-surface-900/50 backdrop-blur-sm" />
        <div className="card p-6 md:p-7 w-full max-w-md relative shadow-lift my-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-accent-100 text-accent-600 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-extrabold text-surface-900 mt-4">
            No se pudo iniciar el pago
          </h2>
          <p className="text-sm text-surface-600 mt-2">{error}</p>
          <div className="mt-5 flex flex-col gap-2.5">
            <button onClick={() => setStep('method')} className="btn-primary w-full">
              Intentar de nuevo
            </button>
            <button
              onClick={handleClose}
              className="w-full text-center text-sm font-semibold text-surface-500 hover:text-surface-700 py-2 rounded-lg transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'nequi-pending') {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
        <div className="absolute inset-0 bg-surface-900/50 backdrop-blur-sm" />
        <div className="card p-6 md:p-7 w-full max-w-md relative shadow-lift my-8 text-center">
          <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
            <Smartphone className="w-7 h-7 animate-pulse" />
          </div>
          <h2 className="text-xl font-extrabold text-surface-900 mt-4">
            Confirma en tu app Nequi
          </h2>
          <p className="text-sm text-surface-600 mt-2">
            Enviamos una solicitud de pago al número <strong>{phone}</strong>.
            Abre Nequi y aprueba el pago de{' '}
            <strong>${sel ? selCyclePrice(sel) : ''}</strong>. Esta ventana se
            actualiza sola cuando se confirme.
          </p>
          <div className="mt-5 flex flex-col gap-2.5">
            <button onClick={handleClose} className="btn-primary w-full">Volver al dashboard</button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'method' && sel) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
        <div className="absolute inset-0 bg-surface-900/50 backdrop-blur-sm" />
        <div className="card p-6 md:p-7 w-full max-w-md relative shadow-lift my-8">
          <button
            onClick={() => setStep('plan')}
            aria-label="Volver"
            className="flex items-center gap-1 text-sm font-semibold text-surface-500 hover:text-surface-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Plan
          </button>
          <h2 className="text-xl font-extrabold text-surface-900 mt-3">
            ¿Cómo quieres pagar? <span className="text-brand-600">{sel.plan}</span>
          </h2>
          <p className="text-sm text-surface-500 mt-1">Monto a pagar: ${selCyclePrice(sel)}. Elige tu medio:</p>

          <div className="mt-5 grid gap-3">
            <button
              onClick={() => setStep('nequi')}
              className="flex items-center gap-3 p-4 rounded-2xl border-2 border-emerald-500/60 bg-emerald-50 hover:bg-emerald-100 transition-colors text-left"
            >
              <div className="w-11 h-11 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0">
                <Smartphone className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-surface-900">Pagar con Nequi</p>
                <p className="text-sm text-surface-600">Apruebas el pago desde tu app Nequi</p>
              </div>
            </button>

            <button
              onClick={handlePagarMercadoPago}
              className="flex items-center gap-3 p-4 rounded-2xl border-2 border-brand-500/60 bg-brand-50 hover:bg-brand-100 transition-colors text-left"
            >
              <div className="w-11 h-11 rounded-xl bg-brand-600 text-white flex items-center justify-center shrink-0">
                <CreditCard className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-surface-900">Pagar con tarjeta, PSE y más</p>
                <p className="text-sm text-surface-600">Mercado Pago: tarjeta, PSE, bancolombia, efectivo</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Paso Nequi (ingresar número) cuando el usuario eligió Nequi.
  if (step === 'nequi' && sel) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 overflow-y-auto">
        <div className="absolute inset-0 bg-surface-900/50 backdrop-blur-sm" />
        <div className="card p-6 md:p-7 w-full max-w-md relative shadow-lift my-8">
          <button
            onClick={() => setStep('method')}
            aria-label="Volver"
            className="flex items-center gap-1 text-sm font-semibold text-surface-500 hover:text-surface-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Método de pago
          </button>
          <h2 className="text-xl font-extrabold text-surface-900 mt-3">Pagar con Nequi</h2>
          <p className="text-sm text-surface-500 mt-1">
            Ingresa el número de tu Nequi. Te enviaremos una solicitud de pago
            para que la apruebes desde tu app.
          </p>
          <div className="mt-4">
            <label className="block text-sm font-semibold text-surface-700 mb-1.5">Número Nequi</label>
            <div className="relative">
              <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                placeholder="3101234567"
                inputMode="numeric"
                autoFocus
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-surface-200 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/50"
              />
            </div>
          </div>
          <button onClick={handlePagarNequi} className="btn-primary w-full mt-5">
            Solicitar pago por Nequi
          </button>
          <button
            onClick={handleClose}
            className="w-full text-center text-sm font-semibold text-surface-500 hover:text-surface-700 py-2 rounded-lg transition-colors mt-2"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <SpacePlanModal
      open={step === 'plan'}
      mode="upgrade"
      onUpgrade={handleUpgrade}
      onClose={handleClose}
    />
  );
}

function selCyclePrice(sel: UpgradeSelection): string {
  return (sel.cycle === 'MONTHLY' ? '$20.000' : '$30.000');
}